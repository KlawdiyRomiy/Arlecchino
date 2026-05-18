package ai

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const modelCapabilityProbesFileName = "model_capability_probes.jsonl"

type ModelCapabilityProbeLedger struct {
	mu   sync.Mutex
	path string
}

func openModelCapabilityProbeLedger(projectRoot string) (*ModelCapabilityProbeLedger, error) {
	dir := filepath.Join(projectRoot, ".arlecchino", "ai")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	return &ModelCapabilityProbeLedger{path: filepath.Join(dir, modelCapabilityProbesFileName)}, nil
}

func (l *ModelCapabilityProbeLedger) Upsert(result AIModelCapabilityProbeResult) error {
	if l == nil || strings.TrimSpace(result.ProviderID) == "" || strings.TrimSpace(result.Model) == "" {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	results, err := l.readAllLocked()
	if err != nil {
		return err
	}
	replaced := false
	for i := range results {
		if results[i].ProviderID == result.ProviderID && results[i].Model == result.Model {
			results[i] = result
			replaced = true
			break
		}
	}
	if !replaced {
		results = append(results, result)
	}
	return l.writeAllLocked(results)
}

func (l *ModelCapabilityProbeLedger) Get(providerID string, model string) (AIModelCapabilityProbeResult, bool) {
	if l == nil || strings.TrimSpace(providerID) == "" || strings.TrimSpace(model) == "" {
		return AIModelCapabilityProbeResult{}, false
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	results, err := l.readAllLocked()
	if err != nil {
		return AIModelCapabilityProbeResult{}, false
	}
	for _, result := range results {
		if result.ProviderID == providerID && result.Model == model {
			return result, true
		}
	}
	return AIModelCapabilityProbeResult{}, false
}

func (l *ModelCapabilityProbeLedger) List() ([]AIModelCapabilityProbeResult, error) {
	if l == nil {
		return []AIModelCapabilityProbeResult{}, nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.readAllLocked()
}

func (l *ModelCapabilityProbeLedger) Clear() error {
	if l == nil {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if err := os.Remove(l.path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (l *ModelCapabilityProbeLedger) readAllLocked() ([]AIModelCapabilityProbeResult, error) {
	file, err := os.Open(l.path)
	if err != nil {
		if os.IsNotExist(err) {
			return []AIModelCapabilityProbeResult{}, nil
		}
		return nil, err
	}
	defer file.Close()
	results := []AIModelCapabilityProbeResult{}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 4096), 1024*1024)
	for scanner.Scan() {
		var result AIModelCapabilityProbeResult
		if err := json.Unmarshal(scanner.Bytes(), &result); err == nil && result.ProviderID != "" && result.Model != "" {
			results = append(results, result)
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return results, nil
}

func (l *ModelCapabilityProbeLedger) writeAllLocked(results []AIModelCapabilityProbeResult) error {
	dir := filepath.Dir(l.path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	file, err := os.CreateTemp(dir, ".model_capability_probes-*.tmp")
	if err != nil {
		return err
	}
	tempPath := file.Name()
	removeTemp := true
	defer func() {
		if removeTemp {
			_ = os.Remove(tempPath)
		}
	}()
	encoder := json.NewEncoder(file)
	for _, result := range results {
		if strings.TrimSpace(result.ProviderID) == "" || strings.TrimSpace(result.Model) == "" {
			continue
		}
		if err := encoder.Encode(result); err != nil {
			_ = file.Close()
			return err
		}
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := os.Rename(tempPath, l.path); err != nil {
		return err
	}
	removeTemp = false
	return nil
}

func modelCapabilityProbeFresh(result AIModelCapabilityProbeResult) bool {
	if strings.TrimSpace(result.ExpiresAt) == "" {
		return false
	}
	expiresAt, err := time.Parse(time.RFC3339, result.ExpiresAt)
	return err == nil && expiresAt.After(time.Now().UTC())
}
