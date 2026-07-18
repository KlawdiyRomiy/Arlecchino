package ai

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"sync"

	"github.com/google/uuid"
)

const (
	agentPluginRegistryFileName = "agent_plugins.jsonl"
	agentPluginEventsFileName   = "agent_plugin_events.jsonl"
	agentPluginStorageFileName  = "agent_plugin_storage.jsonl"
	maxPluginStorageValueBytes  = 64 * 1024
)

var (
	agentPluginIDPattern           = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]{1,95}$`)
	agentPluginStorageSensitiveKey = regexp.MustCompile(`(?i)(secret|token|password|credential|api[_-]?key|private[_-]?key)`)
)

// AgentPluginLedger is a declarative, reviewed plugin registry. It persists
// manifests and host-owned state only: third-party code is never loaded into
// the IDE process by this registry.
type AgentPluginLedger struct {
	mu          sync.Mutex
	recordsPath string
	eventsPath  string
	storagePath string
}

func openAgentPluginLedger(projectRoot string) (*AgentPluginLedger, error) {
	recordsPath, err := ledgerPath(projectRoot, agentPluginRegistryFileName)
	if err != nil {
		return nil, err
	}
	eventsPath, err := ledgerPath(projectRoot, agentPluginEventsFileName)
	if err != nil {
		return nil, err
	}
	storagePath, err := ledgerPath(projectRoot, agentPluginStorageFileName)
	if err != nil {
		return nil, err
	}
	return &AgentPluginLedger{recordsPath: recordsPath, eventsPath: eventsPath, storagePath: storagePath}, nil
}

func (l *AgentPluginLedger) List() ([]AIAgentPluginRecord, error) {
	if l == nil {
		return []AIAgentPluginRecord{}, nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	records, err := readJSONLLocked[AIAgentPluginRecord](l.recordsPath)
	if err != nil {
		return nil, err
	}
	for index := range records {
		records[index] = normalizeAgentPluginRecord(records[index])
	}
	sort.SliceStable(records, func(i, j int) bool { return records[i].Manifest.ID < records[j].Manifest.ID })
	return records, nil
}

func (l *AgentPluginLedger) Get(pluginID string) (AIAgentPluginRecord, bool, error) {
	if l == nil {
		return AIAgentPluginRecord{}, false, nil
	}
	pluginID = strings.TrimSpace(pluginID)
	l.mu.Lock()
	defer l.mu.Unlock()
	records, err := readJSONLLocked[AIAgentPluginRecord](l.recordsPath)
	if err != nil {
		return AIAgentPluginRecord{}, false, err
	}
	for _, record := range records {
		if record.Manifest.ID == pluginID {
			return normalizeAgentPluginRecord(record), true, nil
		}
	}
	return AIAgentPluginRecord{}, false, nil
}

func (l *AgentPluginLedger) Upsert(record AIAgentPluginRecord) (AIAgentPluginRecord, error) {
	if l == nil {
		return AIAgentPluginRecord{}, fmt.Errorf("agent plugin registry is unavailable")
	}
	record = normalizeAgentPluginRecord(record)
	l.mu.Lock()
	defer l.mu.Unlock()
	records, err := readJSONLLocked[AIAgentPluginRecord](l.recordsPath)
	if err != nil {
		return AIAgentPluginRecord{}, err
	}
	for index := range records {
		if records[index].Manifest.ID == record.Manifest.ID {
			record.InstalledAt = firstNonEmpty(records[index].InstalledAt, record.InstalledAt)
			records[index] = record
			return record, writeJSONLLocked(l.recordsPath, records)
		}
	}
	records = append(records, record)
	sort.SliceStable(records, func(i, j int) bool { return records[i].Manifest.ID < records[j].Manifest.ID })
	return record, writeJSONLLocked(l.recordsPath, records)
}

func (l *AgentPluginLedger) ListEvents(pluginID string, limit int) ([]AIAgentPluginEvent, error) {
	if l == nil {
		return []AIAgentPluginEvent{}, nil
	}
	pluginID = strings.TrimSpace(pluginID)
	l.mu.Lock()
	defer l.mu.Unlock()
	events, err := readJSONLLocked[AIAgentPluginEvent](l.eventsPath)
	if err != nil {
		return nil, err
	}
	filtered := make([]AIAgentPluginEvent, 0, len(events))
	for _, event := range events {
		if pluginID == "" || event.PluginID == pluginID {
			filtered = append(filtered, normalizeAgentPluginEvent(event))
		}
	}
	sort.SliceStable(filtered, func(i, j int) bool { return filtered[i].CreatedAt > filtered[j].CreatedAt })
	if limit > 0 && len(filtered) > limit {
		filtered = filtered[:limit]
	}
	return filtered, nil
}

func (l *AgentPluginLedger) AppendEvent(event AIAgentPluginEvent) (AIAgentPluginEvent, error) {
	if l == nil {
		return AIAgentPluginEvent{}, fmt.Errorf("agent plugin registry is unavailable")
	}
	event = normalizeAgentPluginEvent(event)
	l.mu.Lock()
	defer l.mu.Unlock()
	events, err := readJSONLLocked[AIAgentPluginEvent](l.eventsPath)
	if err != nil {
		return AIAgentPluginEvent{}, err
	}
	events = append(events, event)
	return event, writeJSONLLocked(l.eventsPath, events)
}

func (l *AgentPluginLedger) GetStorage(pluginID, key string) (AIAgentPluginStorageValue, bool, error) {
	if l == nil {
		return AIAgentPluginStorageValue{}, false, nil
	}
	pluginID, key = strings.TrimSpace(pluginID), strings.TrimSpace(key)
	l.mu.Lock()
	defer l.mu.Unlock()
	values, err := readJSONLLocked[AIAgentPluginStorageValue](l.storagePath)
	if err != nil {
		return AIAgentPluginStorageValue{}, false, err
	}
	for _, value := range values {
		if value.PluginID == pluginID && value.Key == key {
			return value, true, nil
		}
	}
	return AIAgentPluginStorageValue{}, false, nil
}

func (l *AgentPluginLedger) PutStorage(value AIAgentPluginStorageValue) (AIAgentPluginStorageValue, error) {
	if l == nil {
		return AIAgentPluginStorageValue{}, fmt.Errorf("agent plugin registry is unavailable")
	}
	value = normalizeAgentPluginStorageValue(value)
	l.mu.Lock()
	defer l.mu.Unlock()
	values, err := readJSONLLocked[AIAgentPluginStorageValue](l.storagePath)
	if err != nil {
		return AIAgentPluginStorageValue{}, err
	}
	for index := range values {
		if values[index].PluginID == value.PluginID && values[index].Key == value.Key {
			values[index] = value
			return value, writeJSONLLocked(l.storagePath, values)
		}
	}
	values = append(values, value)
	return value, writeJSONLLocked(l.storagePath, values)
}

func (s *Service) InstallAgentPlugin(projectID string, req AIAgentPluginInstallRequest) (AIAgentPluginRecord, error) {
	project := s.project(normalizeProjectID(projectID))
	if project == nil || project.AgentPlugins == nil {
		return AIAgentPluginRecord{}, fmt.Errorf("AI project session is not open")
	}
	if !req.ReviewAccepted {
		return AIAgentPluginRecord{}, fmt.Errorf("plugin installation requires explicit reviewed acceptance")
	}
	if err := validateAgentPluginManifest(req.Manifest); err != nil {
		return AIAgentPluginRecord{}, err
	}
	req.Manifest = normalizeAgentPluginManifest(req.Manifest)
	existing, found, err := project.AgentPlugins.Get(req.Manifest.ID)
	if err != nil {
		return AIAgentPluginRecord{}, err
	}
	now := utcNow()
	record := AIAgentPluginRecord{Manifest: req.Manifest, State: "installed", Reviewed: true, Enabled: false, Reason: "installed disabled until explicitly enabled", InstalledAt: now, UpdatedAt: now}
	if found {
		record.InstalledAt = existing.InstalledAt
		record.PreviousManifests = append(append([]AIAgentPluginManifest{}, existing.PreviousManifests...), existing.Manifest)
	}
	record, err = project.AgentPlugins.Upsert(record)
	if err != nil {
		return AIAgentPluginRecord{}, err
	}
	s.emitAgentPluginEvent(project, req.Manifest.ID, "installed", "Plugin manifest reviewed and installed in disabled state.", "")
	s.emitEvent("ai:plugin:changed", record)
	return record, nil
}

func (s *Service) SetAgentPluginEnabled(projectID, pluginID string, enabled bool) (AIAgentPluginRecord, error) {
	project := s.project(normalizeProjectID(projectID))
	if project == nil || project.AgentPlugins == nil {
		return AIAgentPluginRecord{}, fmt.Errorf("AI project session is not open")
	}
	record, found, err := project.AgentPlugins.Get(pluginID)
	if err != nil {
		return AIAgentPluginRecord{}, err
	}
	if !found {
		return AIAgentPluginRecord{}, fmt.Errorf("plugin %q is not installed", strings.TrimSpace(pluginID))
	}
	if enabled && !record.Reviewed {
		return AIAgentPluginRecord{}, fmt.Errorf("plugin %q has not been reviewed", record.Manifest.ID)
	}
	record.Enabled = enabled
	record.State = map[bool]string{true: "enabled", false: "disabled"}[enabled]
	record.Reason = map[bool]string{true: "enabled after manifest review", false: "disabled by user"}[enabled]
	record.UpdatedAt = utcNow()
	record, err = project.AgentPlugins.Upsert(record)
	if err != nil {
		return AIAgentPluginRecord{}, err
	}
	eventType := "disabled"
	if enabled {
		eventType = "enabled"
	}
	s.emitAgentPluginEvent(project, record.Manifest.ID, eventType, record.Reason, "")
	s.emitEvent("ai:plugin:changed", record)
	return record, nil
}

func (s *Service) RollbackAgentPlugin(projectID, pluginID string) (AIAgentPluginRecord, error) {
	project := s.project(normalizeProjectID(projectID))
	if project == nil || project.AgentPlugins == nil {
		return AIAgentPluginRecord{}, fmt.Errorf("AI project session is not open")
	}
	record, found, err := project.AgentPlugins.Get(pluginID)
	if err != nil {
		return AIAgentPluginRecord{}, err
	}
	if !found || len(record.PreviousManifests) == 0 {
		return AIAgentPluginRecord{}, fmt.Errorf("plugin %q has no reviewed version to roll back to", strings.TrimSpace(pluginID))
	}
	last := len(record.PreviousManifests) - 1
	previous := record.PreviousManifests[last]
	record.PreviousManifests = append(record.PreviousManifests[:last], record.Manifest)
	record.Manifest = previous
	record.Enabled = false
	record.State = "rolled_back"
	record.Reason = "rolled back to a reviewed manifest and disabled pending re-enable"
	record.UpdatedAt = utcNow()
	record, err = project.AgentPlugins.Upsert(record)
	if err != nil {
		return AIAgentPluginRecord{}, err
	}
	s.emitAgentPluginEvent(project, record.Manifest.ID, "rolled_back", record.Reason, "")
	s.emitEvent("ai:plugin:changed", record)
	return record, nil
}

func (s *Service) ListAgentPlugins(projectID string) ([]AIAgentPluginRecord, error) {
	project := s.project(normalizeProjectID(projectID))
	if project == nil || project.AgentPlugins == nil {
		return []AIAgentPluginRecord{}, nil
	}
	return project.AgentPlugins.List()
}

func (s *Service) ListAgentPluginEvents(projectID, pluginID string, limit int) ([]AIAgentPluginEvent, error) {
	project := s.project(normalizeProjectID(projectID))
	if project == nil || project.AgentPlugins == nil {
		return []AIAgentPluginEvent{}, nil
	}
	return project.AgentPlugins.ListEvents(pluginID, limit)
}

func (s *Service) GetAgentPluginStorage(projectID, pluginID, key string) (AIAgentPluginStorageValue, error) {
	project := s.project(normalizeProjectID(projectID))
	if project == nil || project.AgentPlugins == nil {
		return AIAgentPluginStorageValue{}, fmt.Errorf("AI project session is not open")
	}
	if _, found, err := project.AgentPlugins.Get(pluginID); err != nil || !found {
		if err != nil {
			return AIAgentPluginStorageValue{}, err
		}
		return AIAgentPluginStorageValue{}, fmt.Errorf("plugin %q is not installed", strings.TrimSpace(pluginID))
	}
	value, found, err := project.AgentPlugins.GetStorage(pluginID, key)
	if err != nil {
		return AIAgentPluginStorageValue{}, err
	}
	if !found {
		return AIAgentPluginStorageValue{}, fmt.Errorf("plugin storage key %q was not found", strings.TrimSpace(key))
	}
	return value, nil
}

func (s *Service) PutAgentPluginStorage(projectID string, value AIAgentPluginStorageValue) (AIAgentPluginStorageValue, error) {
	project := s.project(normalizeProjectID(projectID))
	if project == nil || project.AgentPlugins == nil {
		return AIAgentPluginStorageValue{}, fmt.Errorf("AI project session is not open")
	}
	record, found, err := project.AgentPlugins.Get(value.PluginID)
	if err != nil {
		return AIAgentPluginStorageValue{}, err
	}
	if !found || !record.Enabled || !pluginHasCapability(record.Manifest, AIAgentPluginCapabilityStorage) {
		return AIAgentPluginStorageValue{}, fmt.Errorf("plugin storage is unavailable until a reviewed enabled plugin requests storage capability")
	}
	if err := validateAgentPluginStorageValue(value); err != nil {
		return AIAgentPluginStorageValue{}, err
	}
	stored, err := project.AgentPlugins.PutStorage(value)
	if err == nil {
		s.emitAgentPluginEvent(project, record.Manifest.ID, "storage_updated", "Plugin host storage updated.", "")
	}
	return stored, err
}

func (s *Service) ListAgentPluginTools(projectID string) ([]AIAgentPluginToolDefinition, error) {
	records, err := s.ListAgentPlugins(projectID)
	if err != nil {
		return nil, err
	}
	definitions := []AIAgentPluginToolDefinition{}
	for _, record := range records {
		for _, descriptor := range record.Manifest.ToolDefinitions {
			state, reason := "registered_disabled", "plugin is disabled"
			if record.Enabled {
				state, reason = "registered_waiting_for_sandbox", "declarative tool is registered; no plugin code runs in the IDE process"
				if len(record.Manifest.Runner.Command) > 0 {
					state, reason = "sandbox_configured", "signed plugin runner is available only through the capability-scoped sandbox host bridge"
				}
			}
			descriptor.ExecutionAvailable = false
			definitions = append(definitions, AIAgentPluginToolDefinition{PluginID: record.Manifest.ID, Descriptor: descriptor, State: state, Reason: reason})
		}
	}
	return definitions, nil
}

func (s *Service) emitAgentPluginEvent(project *ProjectSession, pluginID, eventType, summary, runID string) {
	if project == nil || project.AgentPlugins == nil {
		return
	}
	event, err := project.AgentPlugins.AppendEvent(AIAgentPluginEvent{PluginID: pluginID, Type: eventType, RunID: runID, Summary: summary})
	if err == nil {
		s.emitEvent("ai:plugin:event", event)
	}
}

func validateAgentPluginManifest(manifest AIAgentPluginManifest) error {
	if manifest.ID != strings.TrimSpace(manifest.ID) ||
		manifest.Version != strings.TrimSpace(manifest.Version) ||
		manifest.Publisher != strings.TrimSpace(manifest.Publisher) ||
		manifest.PublisherKey != strings.TrimSpace(manifest.PublisherKey) ||
		manifest.Signature != strings.TrimSpace(manifest.Signature) ||
		manifest.APIVersion != strings.TrimSpace(manifest.APIVersion) {
		return fmt.Errorf("plugin manifest identity fields must be canonical before signing")
	}
	manifest.ID = strings.TrimSpace(manifest.ID)
	if !agentPluginIDPattern.MatchString(manifest.ID) || strings.HasPrefix(manifest.ID, "arlecchino.") {
		return fmt.Errorf("plugin id must be a lowercase public identifier outside the reserved arlecchino namespace")
	}
	if strings.TrimSpace(manifest.Version) == "" || strings.TrimSpace(manifest.Publisher) == "" || strings.TrimSpace(manifest.APIVersion) != "arlecchino-agent-plugin/v1" {
		return fmt.Errorf("plugin manifest requires version, publisher, and apiVersion arlecchino-agent-plugin/v1")
	}
	if err := verifyAgentPluginManifestSignature(manifest); err != nil {
		return err
	}
	seenCapabilities := map[AIAgentPluginCapability]struct{}{}
	for _, capability := range manifest.Capabilities {
		switch capability {
		case AIAgentPluginCapabilityContextRead, AIAgentPluginCapabilityToolPropose, AIAgentPluginCapabilityStatusWidget, AIAgentPluginCapabilityStorage, AIAgentPluginCapabilityEvents:
			if _, seen := seenCapabilities[capability]; seen {
				return fmt.Errorf("plugin manifest repeats capability %q", capability)
			}
			seenCapabilities[capability] = struct{}{}
		default:
			return fmt.Errorf("plugin manifest requests unsupported capability %q", capability)
		}
	}
	if err := validateAgentPluginRunner(manifest.Runner); err != nil {
		return err
	}
	for _, descriptor := range manifest.ToolDefinitions {
		if descriptor.ID != strings.TrimSpace(descriptor.ID) {
			return fmt.Errorf("plugin tool ids must be canonical before signing")
		}
		if !pluginHasCapability(manifest, AIAgentPluginCapabilityToolPropose) {
			return fmt.Errorf("plugin tool definitions require tool.propose capability")
		}
		if !strings.HasPrefix(strings.TrimSpace(descriptor.ID), "plugin."+manifest.ID+".") {
			return fmt.Errorf("plugin tool %q must be namespaced as plugin.%s.*", descriptor.ID, manifest.ID)
		}
		if descriptor.Kind != AIToolKindContextRead {
			return fmt.Errorf("plugin tool %q must be declarative and read-only", descriptor.ID)
		}
	}
	if len(manifest.WidgetIDs) > 8 {
		return fmt.Errorf("plugin manifest exceeds the status-widget limit")
	}
	seenWidgets := map[string]struct{}{}
	for _, widgetID := range manifest.WidgetIDs {
		if widgetID != strings.TrimSpace(widgetID) {
			return fmt.Errorf("plugin widget ids must be canonical before signing")
		}
		widgetID = strings.TrimSpace(widgetID)
		if !pluginHasCapability(manifest, AIAgentPluginCapabilityStatusWidget) {
			return fmt.Errorf("plugin widget ids require status.widget capability")
		}
		if !strings.HasPrefix(widgetID, "plugin."+manifest.ID+".") || !agentPluginIDPattern.MatchString(widgetID) {
			return fmt.Errorf("plugin widget %q must use the plugin.%s.* namespace", widgetID, manifest.ID)
		}
		if _, exists := seenWidgets[widgetID]; exists {
			return fmt.Errorf("plugin manifest repeats widget id %q", widgetID)
		}
		seenWidgets[widgetID] = struct{}{}
	}
	return nil
}

func verifyAgentPluginManifestSignature(manifest AIAgentPluginManifest) error {
	publicKey, err := base64.StdEncoding.DecodeString(strings.TrimSpace(manifest.PublisherKey))
	if err != nil || len(publicKey) != ed25519.PublicKeySize {
		return fmt.Errorf("plugin publisher key must be a base64 Ed25519 public key")
	}
	signature, err := base64.StdEncoding.DecodeString(strings.TrimSpace(manifest.Signature))
	if err != nil || len(signature) != ed25519.SignatureSize {
		return fmt.Errorf("plugin signature must be a base64 Ed25519 signature")
	}
	manifest.Signature = ""
	payload, err := json.Marshal(manifest)
	if err != nil || !ed25519.Verify(ed25519.PublicKey(publicKey), payload, signature) {
		return fmt.Errorf("plugin manifest signature is invalid")
	}
	return nil
}

func pluginHasCapability(manifest AIAgentPluginManifest, wanted AIAgentPluginCapability) bool {
	for _, capability := range manifest.Capabilities {
		if capability == wanted {
			return true
		}
	}
	return false
}

func validateAgentPluginStorageValue(value AIAgentPluginStorageValue) error {
	if !agentPluginIDPattern.MatchString(strings.TrimSpace(value.PluginID)) || strings.TrimSpace(value.Key) == "" || len(value.Key) > 128 {
		return fmt.Errorf("plugin storage requires a valid plugin id and a bounded key")
	}
	if agentPluginStorageSensitiveKey.MatchString(value.Key) {
		return fmt.Errorf("plugin storage cannot hold credentials or secrets")
	}
	if len(value.ValueJSON) == 0 || len(value.ValueJSON) > maxPluginStorageValueBytes || !json.Valid([]byte(value.ValueJSON)) {
		return fmt.Errorf("plugin storage value must be bounded valid JSON")
	}
	return nil
}

func normalizeAgentPluginRecord(record AIAgentPluginRecord) AIAgentPluginRecord {
	record.Manifest = normalizeAgentPluginManifest(record.Manifest)
	record.Manifest.ID = strings.TrimSpace(record.Manifest.ID)
	record.State = firstNonEmpty(strings.TrimSpace(record.State), "installed")
	record.Reason = sanitizedDisplayText(record.Reason)
	record.InstalledAt = firstNonEmpty(record.InstalledAt, utcNow())
	record.UpdatedAt = firstNonEmpty(record.UpdatedAt, record.InstalledAt)
	return record
}

func normalizeAgentPluginManifest(manifest AIAgentPluginManifest) AIAgentPluginManifest {
	// A manifest is signed as one exact JSON payload. Do not trim, sort, or
	// otherwise rewrite fields here: doing so would make a persisted manifest
	// impossible to verify before a later sandbox launch. UI projections apply
	// their own display sanitization and execution restrictions instead.
	return manifest
}

func normalizeAgentPluginEvent(event AIAgentPluginEvent) AIAgentPluginEvent {
	event.ID = firstNonEmpty(strings.TrimSpace(event.ID), "plugin-event-"+uuid.NewString())
	event.PluginID = strings.TrimSpace(event.PluginID)
	event.Type = firstNonEmpty(strings.TrimSpace(event.Type), "host_event")
	event.RunID = strings.TrimSpace(event.RunID)
	event.Summary = sanitizedDisplayText(event.Summary)
	event.CreatedAt = firstNonEmpty(event.CreatedAt, utcNow())
	return event
}

func normalizeAgentPluginStorageValue(value AIAgentPluginStorageValue) AIAgentPluginStorageValue {
	value.PluginID = strings.TrimSpace(value.PluginID)
	value.Key = strings.TrimSpace(value.Key)
	value.UpdatedAt = firstNonEmpty(value.UpdatedAt, utcNow())
	return value
}
