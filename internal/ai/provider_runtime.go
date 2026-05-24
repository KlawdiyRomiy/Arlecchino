package ai

import (
	"bufio"
	"context"
	"fmt"
	"net"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"arlecchino/internal/ai/providers"
)

const (
	localRuntimeStatusUnavailable = "unavailable"
	localRuntimeStatusStopped     = "stopped"
	localRuntimeStatusStarting    = "starting"
	localRuntimeStatusRunning     = "running"
)

type AIProviderRuntimeModel struct {
	ID               string   `json:"id"`
	DisplayName      string   `json:"displayName"`
	ContextWindow    int      `json:"contextWindow,omitempty"`
	Path             string   `json:"path,omitempty"`
	Source           string   `json:"source"`
	Active           bool     `json:"active"`
	Runnable         bool     `json:"runnable"`
	Reason           string   `json:"reason,omitempty"`
	ReasoningEfforts []string `json:"reasoningEfforts,omitempty"`
	AccountScoped    bool     `json:"accountScoped,omitempty"`
}

type AIProviderRuntimeDescriptor struct {
	ProviderID     string                   `json:"providerId"`
	Kind           string                   `json:"kind"`
	Name           string                   `json:"name"`
	Endpoint       string                   `json:"endpoint,omitempty"`
	ExecutablePath string                   `json:"executablePath,omitempty"`
	Running        bool                     `json:"running"`
	Managed        bool                     `json:"managed"`
	PID            int                      `json:"pid,omitempty"`
	Status         string                   `json:"status"`
	Reason         string                   `json:"reason,omitempty"`
	ActiveModel    string                   `json:"activeModel,omitempty"`
	Models         []AIProviderRuntimeModel `json:"models"`
	Logs           []string                 `json:"logs,omitempty"`
}

type AIProviderRuntimeStartRequest struct {
	ProviderID  string `json:"providerId"`
	Kind        string `json:"kind,omitempty"`
	Endpoint    string `json:"endpoint,omitempty"`
	ModelID     string `json:"modelId,omitempty"`
	ModelPath   string `json:"modelPath,omitempty"`
	ContextSize int    `json:"contextSize,omitempty"`
}

type providerRuntimeProcess struct {
	mu         sync.Mutex
	providerID string
	kind       string
	endpoint   string
	modelID    string
	modelPath  string
	cancel     context.CancelFunc
	cmd        *exec.Cmd
	startedAt  time.Time
	logs       []string
}

type providerRuntimeManager struct {
	mu        sync.Mutex
	processes map[string]*providerRuntimeProcess
}

func newProviderRuntimeManager() *providerRuntimeManager {
	return &providerRuntimeManager{processes: map[string]*providerRuntimeProcess{}}
}

func (m *providerRuntimeManager) stopAll() {
	if m == nil {
		return
	}
	m.mu.Lock()
	processes := make([]*providerRuntimeProcess, 0, len(m.processes))
	for _, process := range m.processes {
		processes = append(processes, process)
	}
	m.processes = map[string]*providerRuntimeProcess{}
	m.mu.Unlock()
	for _, process := range processes {
		stopRuntimeProcess(process)
	}
}

func (s *Service) ListProviderRuntimes() []AIProviderRuntimeDescriptor {
	if s == nil {
		return []AIProviderRuntimeDescriptor{}
	}
	descriptors := s.ListProviders()
	runtimes := make([]AIProviderRuntimeDescriptor, 0, len(descriptors))
	for _, descriptor := range descriptors {
		runtimes = append(runtimes, s.runtimeDescriptorForProvider(descriptor))
	}
	sort.SliceStable(runtimes, func(i, j int) bool {
		return runtimeSortRank(runtimes[i].Kind) < runtimeSortRank(runtimes[j].Kind)
	})
	return runtimes
}

func (s *Service) StartProviderRuntime(ctx context.Context, req AIProviderRuntimeStartRequest) (AIProviderRuntimeDescriptor, error) {
	if s == nil {
		return AIProviderRuntimeDescriptor{}, fmt.Errorf("AI service is unavailable")
	}
	req.ProviderID = strings.TrimSpace(req.ProviderID)
	req.Kind = strings.TrimSpace(req.Kind)
	req.ModelID = strings.TrimSpace(req.ModelID)
	req.ModelPath = strings.TrimSpace(req.ModelPath)
	if req.ProviderID == "" {
		return AIProviderRuntimeDescriptor{}, fmt.Errorf("provider id is required")
	}
	descriptor := s.descriptor(req.ProviderID)
	if descriptor.ID == "" {
		return AIProviderRuntimeDescriptor{}, fmt.Errorf("provider %q is not configured", req.ProviderID)
	}
	if descriptor.Frontier || !descriptor.Local {
		return AIProviderRuntimeDescriptor{}, fmt.Errorf("provider %q cannot be launched locally", req.ProviderID)
	}
	if req.Kind == "" {
		req.Kind = descriptor.Kind
	}
	if req.Kind != "llama.cpp" {
		return s.runtimeDescriptorForProvider(descriptor), fmt.Errorf("provider launch for %s is not available; start it externally and refresh providers", descriptor.Name)
	}
	modelPath, err := resolveRunnableModelPath(req.ModelPath, req.ModelID)
	if err != nil {
		return s.runtimeDescriptorForProvider(descriptor), err
	}
	executable, err := exec.LookPath("llama-server")
	if err != nil {
		return s.runtimeDescriptorForProvider(descriptor), fmt.Errorf("llama-server is not installed or not in PATH")
	}
	endpoint := firstNonEmpty(req.Endpoint, descriptor.Endpoint, providers.DefaultLlamaEndpoint)
	host, port, err := runtimeHostPort(endpoint, "127.0.0.1", "8080")
	if err != nil {
		return s.runtimeDescriptorForProvider(descriptor), err
	}
	if host != "127.0.0.1" && host != "localhost" && host != "::1" {
		return s.runtimeDescriptorForProvider(descriptor), fmt.Errorf("local provider endpoint must use localhost, 127.0.0.1, or ::1")
	}
	if portBusy(host, port) && descriptor.Status == providers.ProviderStatusReady {
		return s.runtimeDescriptorForProvider(descriptor), nil
	}
	if req.ContextSize <= 0 {
		req.ContextSize = 4096
	}
	processCtx, cancel := context.WithCancel(context.Background())
	args := []string{
		"-m", modelPath,
		"--host", host,
		"--port", port,
		"-c", strconv.Itoa(req.ContextSize),
	}
	cmd := exec.CommandContext(processCtx, executable, args...)
	cmd.Env = os.Environ()
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return s.runtimeDescriptorForProvider(descriptor), err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		cancel()
		return s.runtimeDescriptorForProvider(descriptor), err
	}
	if err := cmd.Start(); err != nil {
		cancel()
		return s.runtimeDescriptorForProvider(descriptor), err
	}
	process := &providerRuntimeProcess{
		providerID: descriptor.ID,
		kind:       descriptor.Kind,
		endpoint:   endpoint,
		modelID:    firstNonEmpty(req.ModelID, filepath.Base(modelPath)),
		modelPath:  modelPath,
		cancel:     cancel,
		cmd:        cmd,
		startedAt:  time.Now(),
		logs:       []string{fmt.Sprintf("started %s %s", executable, strings.Join(args, " "))},
	}
	s.runtimes.mu.Lock()
	if previous := s.runtimes.processes[descriptor.ID]; previous != nil {
		stopRuntimeProcess(previous)
	}
	s.runtimes.processes[descriptor.ID] = process
	s.runtimes.mu.Unlock()
	go collectRuntimeLogs(process, stdout)
	go collectRuntimeLogs(process, stderr)
	go func() {
		_ = cmd.Wait()
		s.runtimes.mu.Lock()
		if s.runtimes.processes[descriptor.ID] == process {
			delete(s.runtimes.processes, descriptor.ID)
		}
		s.runtimes.mu.Unlock()
	}()
	go func() {
		probeCtx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		ticker := time.NewTicker(900 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-probeCtx.Done():
				return
			case <-ticker.C:
				if _, err := s.refreshLocalProviders(probeCtx, localDiscoveryProviderSettings()); err == nil {
					if current := s.descriptor(descriptor.ID); current.Status == providers.ProviderStatusReady {
						return
					}
				}
			}
		}
	}()
	runtimeDescriptor := s.runtimeDescriptorForProvider(descriptor)
	runtimeDescriptor.Status = localRuntimeStatusStarting
	runtimeDescriptor.Running = true
	runtimeDescriptor.Managed = true
	runtimeDescriptor.PID = cmd.Process.Pid
	s.emitEvent("ai:provider:runtime", runtimeDescriptor)
	return runtimeDescriptor, nil
}

func (s *Service) StopProviderRuntime(ctx context.Context, providerID string) (AIProviderRuntimeDescriptor, error) {
	if s == nil {
		return AIProviderRuntimeDescriptor{}, fmt.Errorf("AI service is unavailable")
	}
	providerID = strings.TrimSpace(providerID)
	descriptor := s.descriptor(providerID)
	if descriptor.ID == "" {
		return AIProviderRuntimeDescriptor{}, fmt.Errorf("provider %q is not configured", providerID)
	}
	s.runtimes.mu.Lock()
	process := s.runtimes.processes[providerID]
	delete(s.runtimes.processes, providerID)
	s.runtimes.mu.Unlock()
	if process == nil {
		return s.runtimeDescriptorForProvider(descriptor), nil
	}
	stopRuntimeProcess(process)
	refreshCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	_, _ = s.refreshLocalProviders(refreshCtx, localDiscoveryProviderSettings())
	runtimeDescriptor := s.runtimeDescriptorForProvider(descriptor)
	s.emitEvent("ai:provider:runtime", runtimeDescriptor)
	return runtimeDescriptor, nil
}

func (s *Service) descriptor(providerID string) providers.AIProviderDescriptor {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return providers.EnrichProviderDescriptorModels(s.descriptors[strings.TrimSpace(providerID)])
}

func (s *Service) runtimeDescriptorForProvider(provider providers.AIProviderDescriptor) AIProviderRuntimeDescriptor {
	runtime := AIProviderRuntimeDescriptor{
		ProviderID:  provider.ID,
		Kind:        provider.Kind,
		Name:        provider.Name,
		Endpoint:    provider.Endpoint,
		Status:      localRuntimeStatusStopped,
		ActiveModel: firstNonEmpty(provider.DefaultModel, firstModelID(provider.Models)),
		Models:      modelsFromProvider(provider),
	}
	if isExternalAgentProviderDescriptor(provider) {
		runtime.Status = localRuntimeStatusUnavailable
		runtime.Reason = firstNonEmpty(provider.Reason, "provider-owned CLI account runtime")
		if provider.Status == providers.ProviderStatusReady {
			runtime.Running = true
			runtime.Status = localRuntimeStatusRunning
		}
		markRuntimeActiveModel(&runtime)
		return runtime
	}
	if !provider.Local || provider.Frontier {
		runtime.Status = localRuntimeStatusUnavailable
		runtime.Reason = "cloud providers are configured through BYOK credentials"
		return runtime
	}
	switch provider.Kind {
	case "llama.cpp":
		if path, err := exec.LookPath("llama-server"); err == nil {
			runtime.ExecutablePath = path
		} else {
			runtime.Status = localRuntimeStatusUnavailable
			runtime.Reason = "llama-server is not installed or not in PATH"
		}
		runtime.Models = mergeRuntimeModels(runtime.Models, discoverGGUFModels(runtime.ExecutablePath != ""))
	case "ollama":
		if path, err := exec.LookPath("ollama"); err == nil {
			runtime.ExecutablePath = path
		} else {
			runtime.Reason = "ollama is not installed or not in PATH"
		}
	case "lm-studio":
		if path, err := exec.LookPath("lms"); err == nil {
			runtime.ExecutablePath = path
		} else {
			runtime.Reason = "LM Studio CLI is not installed or not in PATH"
		}
	case "huggingface-tgi":
		if path, err := exec.LookPath("text-generation-launcher"); err == nil {
			runtime.ExecutablePath = path
		} else if path, err := exec.LookPath("docker"); err == nil {
			runtime.ExecutablePath = path
			runtime.Reason = "Docker is available; configure a TGI image before launch"
		} else {
			runtime.Reason = "TGI launcher or Docker is not installed"
		}
	}
	if provider.Status == providers.ProviderStatusReady {
		runtime.Running = true
		runtime.Status = localRuntimeStatusRunning
	}
	if s != nil && s.runtimes != nil {
		s.runtimes.mu.Lock()
		if process := s.runtimes.processes[provider.ID]; process != nil {
			runtime.Running = true
			runtime.Managed = true
			runtime.Status = localRuntimeStatusStarting
			if provider.Status == providers.ProviderStatusReady {
				runtime.Status = localRuntimeStatusRunning
			}
			if process.cmd != nil && process.cmd.Process != nil {
				runtime.PID = process.cmd.Process.Pid
			}
			runtime.ActiveModel = firstNonEmpty(process.modelID, runtime.ActiveModel)
			process.mu.Lock()
			runtime.Logs = append([]string{}, process.logs...)
			process.mu.Unlock()
		}
		s.runtimes.mu.Unlock()
	}
	markRuntimeActiveModel(&runtime)
	return runtime
}

func markRuntimeActiveModel(runtime *AIProviderRuntimeDescriptor) {
	if runtime == nil {
		return
	}
	for i := range runtime.Models {
		if runtime.Models[i].ID == runtime.ActiveModel || runtime.Models[i].Path != "" && filepath.Base(runtime.Models[i].Path) == runtime.ActiveModel {
			runtime.Models[i].Active = true
		}
		if runtime.Models[i].Runnable && runtime.ExecutablePath == "" {
			runtime.Models[i].Runnable = false
			runtime.Models[i].Reason = firstNonEmpty(runtime.Models[i].Reason, runtime.Reason)
		}
	}
}

func runtimeSortRank(kind string) int {
	switch kind {
	case "ollama":
		return 0
	case "lm-studio":
		return 1
	case "llama.cpp":
		return 2
	case "huggingface-tgi":
		return 3
	default:
		return 10
	}
}

func modelsFromProvider(provider providers.AIProviderDescriptor) []AIProviderRuntimeModel {
	models := make([]AIProviderRuntimeModel, 0, len(provider.Models))
	for _, model := range provider.Models {
		id := strings.TrimSpace(model.ID)
		if id == "" {
			continue
		}
		models = append(models, AIProviderRuntimeModel{
			ID:               id,
			DisplayName:      firstNonEmpty(model.DisplayName, id),
			ContextWindow:    model.ContextWindow,
			Source:           modelSource(model),
			Active:           id == provider.DefaultModel,
			Runnable:         false,
			ReasoningEfforts: append([]string{}, model.ReasoningEfforts...),
			AccountScoped:    model.AccountScoped,
		})
	}
	return models
}

func modelSource(model providers.AIModelDescriptor) string {
	if model.AccountScoped {
		return "account"
	}
	return "active"
}

func mergeRuntimeModels(left []AIProviderRuntimeModel, right []AIProviderRuntimeModel) []AIProviderRuntimeModel {
	seen := map[string]int{}
	out := make([]AIProviderRuntimeModel, 0, len(left)+len(right))
	for _, model := range append(left, right...) {
		key := firstNonEmpty(model.Path, model.ID)
		if key == "" {
			continue
		}
		if index, ok := seen[key]; ok {
			if out[index].Source != "active" && model.Source == "active" {
				out[index].Source = model.Source
			}
			out[index].Active = out[index].Active || model.Active
			out[index].Runnable = out[index].Runnable || model.Runnable
			continue
		}
		seen[key] = len(out)
		out = append(out, model)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Active != out[j].Active {
			return out[i].Active
		}
		return out[i].DisplayName < out[j].DisplayName
	})
	return out
}

func discoverGGUFModels(runnable bool) []AIProviderRuntimeModel {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	roots := []string{
		filepath.Join(home, "Library", "Application Support", "app.cotypist.Cotypist", "Models"),
		filepath.Join(home, ".arlecchino", "models"),
		filepath.Join(home, "Models"),
		filepath.Join(home, ".cache", "huggingface", "hub"),
	}
	models := []AIProviderRuntimeModel{}
	seen := map[string]struct{}{}
	for _, root := range roots {
		root = filepath.Clean(root)
		info, err := os.Stat(root)
		if err != nil || !info.IsDir() {
			continue
		}
		rootDepth := strings.Count(root, string(os.PathSeparator))
		_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if entry.IsDir() {
				if strings.Count(path, string(os.PathSeparator))-rootDepth > 5 {
					return filepath.SkipDir
				}
				return nil
			}
			if len(models) >= 80 {
				return filepath.SkipAll
			}
			if !strings.EqualFold(filepath.Ext(path), ".gguf") {
				return nil
			}
			if _, exists := seen[path]; exists {
				return nil
			}
			seen[path] = struct{}{}
			id := filepath.Base(path)
			models = append(models, AIProviderRuntimeModel{
				ID:          id,
				DisplayName: strings.TrimSuffix(id, filepath.Ext(id)),
				Path:        path,
				Source:      "installed",
				Runnable:    runnable,
			})
			return nil
		})
	}
	return models
}

func resolveRunnableModelPath(modelPath string, modelID string) (string, error) {
	if modelPath != "" {
		info, err := os.Stat(modelPath)
		if err != nil {
			return "", fmt.Errorf("model file is not accessible: %w", err)
		}
		if info.IsDir() {
			return "", fmt.Errorf("model path must point to a GGUF file")
		}
		return modelPath, nil
	}
	for _, model := range discoverGGUFModels(true) {
		if model.ID == modelID || model.DisplayName == modelID {
			return model.Path, nil
		}
	}
	return "", fmt.Errorf("select an installed GGUF model before starting llama.cpp")
}

func runtimeHostPort(endpoint string, fallbackHost string, fallbackPort string) (string, string, error) {
	parsed, err := url.Parse(strings.TrimSpace(endpoint))
	if err != nil {
		return "", "", fmt.Errorf("invalid provider endpoint: %w", err)
	}
	host := parsed.Hostname()
	port := parsed.Port()
	if host == "" {
		host = fallbackHost
	}
	if port == "" {
		port = fallbackPort
	}
	return host, port, nil
}

func portBusy(host string, port string) bool {
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, port), 180*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

func collectRuntimeLogs(process *providerRuntimeProcess, pipe interface{ Read([]byte) (int, error) }) {
	scanner := bufio.NewScanner(pipe)
	scanner.Buffer(make([]byte, 0, 4096), 64*1024)
	for scanner.Scan() {
		appendRuntimeLog(process, scanner.Text())
	}
}

func appendRuntimeLog(process *providerRuntimeProcess, line string) {
	if process == nil {
		return
	}
	line = strings.TrimSpace(line)
	if line == "" {
		return
	}
	if len(line) > 500 {
		line = line[:500]
	}
	process.mu.Lock()
	defer process.mu.Unlock()
	process.logs = append(process.logs, line)
	if len(process.logs) > 80 {
		process.logs = append([]string{}, process.logs[len(process.logs)-80:]...)
	}
}

func stopRuntimeProcess(process *providerRuntimeProcess) {
	if process == nil {
		return
	}
	if process.cancel != nil {
		process.cancel()
	}
	if process.cmd != nil && process.cmd.Process != nil {
		_ = process.cmd.Process.Kill()
	}
}

func firstModelID(models []providers.AIModelDescriptor) string {
	if len(models) == 0 {
		return ""
	}
	return strings.TrimSpace(models[0].ID)
}
