package ai

import (
	"sort"
	"strings"
	"sync"
)

const runGraphFileName = "run_graph.jsonl"

// RunGraphLedger persists the compact topology of agent work independently of
// chat history. Chat history may be compacted or hidden from a provider; graph
// edges and task epochs must remain inspectable and replayable.
type RunGraphLedger struct {
	mu   sync.Mutex
	path string
}

func openRunGraphLedger(projectRoot string) (*RunGraphLedger, error) {
	path, err := ledgerPath(projectRoot, runGraphFileName)
	if err != nil {
		return nil, err
	}
	return &RunGraphLedger{path: path}, nil
}

func (l *RunGraphLedger) Upsert(node AIRunGraphNode) (AIRunGraphNode, error) {
	if l == nil || strings.TrimSpace(node.RunID) == "" {
		return node, nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	nodes, err := readJSONLLocked[AIRunGraphNode](l.path)
	if err != nil {
		return AIRunGraphNode{}, err
	}
	node = normalizeRunGraphNode(node)
	for index := range nodes {
		if nodes[index].RunID != node.RunID {
			continue
		}
		existing := normalizeRunGraphNode(nodes[index])
		// Immutable topology comes from the first authoritative registration.
		node.ParentRunID = firstNonEmpty(existing.ParentRunID, node.ParentRunID)
		node.RootRunID = firstNonEmpty(existing.RootRunID, node.RootRunID)
		if existing.TaskEpoch > 0 {
			node.TaskEpoch = existing.TaskEpoch
		}
		node.Source = firstNonEmptyGraphSource(existing.Source, node.Source)
		node.CorrelationID = firstNonEmpty(existing.CorrelationID, node.CorrelationID)
		node.CreatedAt = firstNonEmpty(existing.CreatedAt, node.CreatedAt)
		nodes[index] = node
		return node, writeJSONLLocked(l.path, nodes)
	}
	nodes = append(nodes, node)
	sort.SliceStable(nodes, func(i, j int) bool { return nodes[i].CreatedAt < nodes[j].CreatedAt })
	return node, writeJSONLLocked(l.path, nodes)
}

func (l *RunGraphLedger) Get(runID string) (AIRunGraphNode, bool, error) {
	if l == nil || strings.TrimSpace(runID) == "" {
		return AIRunGraphNode{}, false, nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	nodes, err := readJSONLLocked[AIRunGraphNode](l.path)
	if err != nil {
		return AIRunGraphNode{}, false, err
	}
	for _, node := range nodes {
		if node.RunID == strings.TrimSpace(runID) {
			return normalizeRunGraphNode(node), true, nil
		}
	}
	return AIRunGraphNode{}, false, nil
}

func (l *RunGraphLedger) ListSession(sessionID string) ([]AIRunGraphNode, error) {
	if l == nil {
		return []AIRunGraphNode{}, nil
	}
	sessionID = normalizeChatSessionID(sessionID)
	l.mu.Lock()
	defer l.mu.Unlock()
	nodes, err := readJSONLLocked[AIRunGraphNode](l.path)
	if err != nil {
		return nil, err
	}
	result := make([]AIRunGraphNode, 0, len(nodes))
	for _, node := range nodes {
		if normalizeChatSessionID(node.SessionID) == sessionID {
			result = append(result, normalizeRunGraphNode(node))
		}
	}
	sort.SliceStable(result, func(i, j int) bool { return result[i].CreatedAt < result[j].CreatedAt })
	return result, nil
}

func (l *RunGraphLedger) DeleteRuns(runIDs []string) error {
	if l == nil || len(runIDs) == 0 {
		return nil
	}
	set := make(map[string]struct{}, len(runIDs))
	for _, runID := range runIDs {
		if runID = strings.TrimSpace(runID); runID != "" {
			set[runID] = struct{}{}
		}
	}
	if len(set) == 0 {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	nodes, err := readJSONLLocked[AIRunGraphNode](l.path)
	if err != nil {
		return err
	}
	kept := nodes[:0]
	for _, node := range nodes {
		if _, remove := set[node.RunID]; !remove {
			kept = append(kept, node)
		}
	}
	return writeJSONLLocked(l.path, kept)
}

func (l *RunGraphLedger) Clear() error {
	if l == nil {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	return writeJSONLLocked(l.path, []AIRunGraphNode{})
}

func normalizeRunGraphNode(node AIRunGraphNode) AIRunGraphNode {
	node.RunID = strings.TrimSpace(node.RunID)
	node.ParentRunID = strings.TrimSpace(node.ParentRunID)
	node.RootRunID = firstNonEmpty(strings.TrimSpace(node.RootRunID), node.RunID)
	node.ProjectSessionID = strings.TrimSpace(node.ProjectSessionID)
	node.SessionID = normalizeChatSessionID(node.SessionID)
	if node.Source == "" {
		node.Source = AIRunGraphSourceUser
	}
	if node.TaskEpoch <= 0 {
		node.TaskEpoch = 1
	}
	node.CorrelationID = strings.TrimSpace(node.CorrelationID)
	node.ProviderID = strings.TrimSpace(node.ProviderID)
	node.Model = strings.TrimSpace(node.Model)
	node.CreatedAt = firstNonEmpty(node.CreatedAt, utcNow())
	node.UpdatedAt = firstNonEmpty(node.UpdatedAt, node.CreatedAt)
	return node
}

func firstNonEmptyGraphSource(values ...AIRunGraphSource) AIRunGraphSource {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return AIRunGraphSourceUser
}

func (s *Service) syncRunGraph(project *ProjectSession, run AIChatRun) *AIRunGraphNode {
	if s == nil || project == nil || project.RunGraph == nil || strings.TrimSpace(run.ID) == "" {
		return nil
	}
	if existing, ok, err := project.RunGraph.Get(run.ID); err == nil && ok {
		existing.Status = run.Status
		existing.Revision = run.Revision
		existing.ProviderID = firstNonEmpty(run.ProviderID, existing.ProviderID)
		existing.Model = firstNonEmpty(run.Model, existing.Model)
		existing.UpdatedAt = firstNonEmpty(run.UpdatedAt, utcNow())
		node, err := project.RunGraph.Upsert(existing)
		if err == nil {
			return &node
		}
		return nil
	}

	inputs := chatRunInputs(run)
	parentID := graphParentRunID(inputs, run.Links)
	source := graphSourceForInputs(inputs, run.Links)
	node := AIRunGraphNode{
		RunID:            run.ID,
		ParentRunID:      parentID,
		RootRunID:        run.ID,
		ProjectSessionID: project.ID,
		SessionID:        run.SessionID,
		Source:           source,
		TaskEpoch:        1,
		Action:           run.Action,
		Status:           run.Status,
		Revision:         run.Revision,
		CorrelationID:    graphCorrelationID(inputs),
		ProviderID:       run.ProviderID,
		Model:            run.Model,
		CreatedAt:        run.CreatedAt,
		UpdatedAt:        run.UpdatedAt,
	}
	if parentID != "" {
		if parent, ok, err := project.RunGraph.Get(parentID); err == nil && ok {
			node.RootRunID = firstNonEmpty(parent.RootRunID, parent.RunID)
			node.TaskEpoch = parent.TaskEpoch
		}
	} else {
		if nodes, err := project.RunGraph.ListSession(run.SessionID); err == nil {
			for _, previous := range nodes {
				if previous.TaskEpoch >= node.TaskEpoch {
					node.TaskEpoch = previous.TaskEpoch + 1
				}
			}
		}
	}
	registered, err := project.RunGraph.Upsert(node)
	if err != nil {
		return nil
	}
	return &registered
}

func (s *Service) ListRunGraph(projectID string, sessionID string) ([]AIRunGraphNode, error) {
	project := s.project(normalizeProjectID(projectID))
	if project == nil || project.RunGraph == nil {
		return []AIRunGraphNode{}, nil
	}
	return project.RunGraph.ListSession(sessionID)
}

func graphParentRunID(inputs []AIChatRunInput, links AIChatRunLinks) string {
	for _, input := range inputs {
		if parentID := strings.TrimSpace(input.ParentRunID); parentID != "" {
			return parentID
		}
	}
	return firstNonEmpty(strings.TrimSpace(links.SourceSubagentParentRunID), strings.TrimSpace(links.SourceQueueRunID), strings.TrimSpace(links.SourcePlanRunID), strings.TrimSpace(links.SourceBuildRunID), strings.TrimSpace(links.AutoReviewForBuildRunID))
}

func graphCorrelationID(inputs []AIChatRunInput) string {
	for _, input := range inputs {
		if correlationID := strings.TrimSpace(input.CorrelationID); correlationID != "" {
			return correlationID
		}
	}
	return ""
}

func graphSourceForInputs(inputs []AIChatRunInput, links AIChatRunLinks) AIRunGraphSource {
	if strings.TrimSpace(links.SourceQueueItemID) != "" {
		return AIRunGraphSourceQueue
	}
	if strings.TrimSpace(links.SourceSubagentParentRunID) != "" {
		return AIRunGraphSourceSubagent
	}
	for _, input := range inputs {
		switch input.Origin {
		case AIChatInputOriginSteer:
			return AIRunGraphSourceSteer
		case AIChatInputOriginWorkflowInstruction:
			return AIRunGraphSourceWorkflow
		case AIChatInputOriginToolContinuation:
			return AIRunGraphSourceTool
		}
	}
	if links.SourcePlanRunID != "" || links.SourceBuildRunID != "" || links.AutoReviewForBuildRunID != "" {
		return AIRunGraphSourceWorkflow
	}
	return AIRunGraphSourceUser
}

func ledgerPath(projectRoot string, filename string) (string, error) {
	path, err := safeProjectPath(projectRoot, ".arlecchino/ai/"+filename)
	if err != nil {
		return "", err
	}
	return path, nil
}
