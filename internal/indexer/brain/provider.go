package brain

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

var (
	ErrProviderNotConfigured = errors.New("provider not configured")
	ErrProviderTimeout       = errors.New("provider request timeout")
	ErrProviderUnavailable   = errors.New("provider unavailable")
)

type AIProvider interface {
	Complete(ctx context.Context, prompt string, maxTokens int) ([]string, error)
	Name() string
	IsLocal() bool
	IsAvailable() bool
}

type ProviderConfig struct {
	Name       string
	BaseURL    string
	APIKey     string
	Model      string
	Timeout    time.Duration
	MaxRetries int
}

type OllamaProvider struct {
	mu      sync.RWMutex
	config  ProviderConfig
	client  *http.Client
	healthy bool
}

func NewOllamaProvider(baseURL, model string) *OllamaProvider {
	if baseURL == "" {
		baseURL = "http://localhost:11434"
	}
	if model == "" {
		model = "codellama:7b-code"
	}

	return &OllamaProvider{
		config: ProviderConfig{
			Name:       "ollama",
			BaseURL:    baseURL,
			Model:      model,
			Timeout:    30 * time.Second,
			MaxRetries: 2,
		},
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
		healthy: true,
	}
}

func (p *OllamaProvider) Name() string {
	return "ollama"
}

func (p *OllamaProvider) IsLocal() bool {
	return true
}

func (p *OllamaProvider) IsAvailable() bool {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.healthy
}

type ollamaRequest struct {
	Model   string                 `json:"model"`
	Prompt  string                 `json:"prompt"`
	Stream  bool                   `json:"stream"`
	Options map[string]interface{} `json:"options,omitempty"`
}

type ollamaResponse struct {
	Response string `json:"response"`
	Done     bool   `json:"done"`
}

func (p *OllamaProvider) Complete(ctx context.Context, prompt string, maxTokens int) ([]string, error) {
	reqBody := ollamaRequest{
		Model:  p.config.Model,
		Prompt: prompt,
		Stream: false,
		Options: map[string]interface{}{
			"num_predict": maxTokens,
			"temperature": 0.2,
			"top_p":       0.9,
		},
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", p.config.BaseURL+"/api/generate", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		p.mu.Lock()
		p.healthy = false
		p.mu.Unlock()
		return nil, ErrProviderUnavailable
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, ErrProviderUnavailable
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var ollamaResp ollamaResponse
	if err := json.Unmarshal(respBody, &ollamaResp); err != nil {
		return nil, err
	}

	p.mu.Lock()
	p.healthy = true
	p.mu.Unlock()

	completions := parseCompletions(ollamaResp.Response)
	return completions, nil
}

type OpenAIProvider struct {
	mu     sync.RWMutex
	config ProviderConfig
	client *http.Client
}

func NewOpenAIProvider(apiKey, model string) *OpenAIProvider {
	if model == "" {
		model = "gpt-4o-mini"
	}

	return &OpenAIProvider{
		config: ProviderConfig{
			Name:       "openai",
			BaseURL:    "https://api.openai.com/v1",
			APIKey:     apiKey,
			Model:      model,
			Timeout:    30 * time.Second,
			MaxRetries: 2,
		},
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (p *OpenAIProvider) Name() string {
	return "openai"
}

func (p *OpenAIProvider) IsLocal() bool {
	return false
}

func (p *OpenAIProvider) IsAvailable() bool {
	return p.config.APIKey != ""
}

type openaiRequest struct {
	Model       string          `json:"model"`
	Messages    []openaiMessage `json:"messages"`
	MaxTokens   int             `json:"max_tokens"`
	Temperature float64         `json:"temperature"`
	N           int             `json:"n"`
}

type openaiMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openaiResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

func (p *OpenAIProvider) Complete(ctx context.Context, prompt string, maxTokens int) ([]string, error) {
	if p.config.APIKey == "" {
		return nil, ErrProviderNotConfigured
	}

	reqBody := openaiRequest{
		Model: p.config.Model,
		Messages: []openaiMessage{
			{Role: "system", Content: "You are a code completion assistant. Return only code, no explanations."},
			{Role: "user", Content: prompt},
		},
		MaxTokens:   maxTokens,
		Temperature: 0.2,
		N:           3,
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", p.config.BaseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+p.config.APIKey)

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, ErrProviderUnavailable
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var openaiResp openaiResponse
	if err := json.Unmarshal(respBody, &openaiResp); err != nil {
		return nil, err
	}

	if openaiResp.Error != nil {
		return nil, errors.New(openaiResp.Error.Message)
	}

	var completions []string
	for _, choice := range openaiResp.Choices {
		if choice.Message.Content != "" {
			completions = append(completions, choice.Message.Content)
		}
	}

	return completions, nil
}

type AnthropicProvider struct {
	mu     sync.RWMutex
	config ProviderConfig
	client *http.Client
}

func NewAnthropicProvider(apiKey, model string) *AnthropicProvider {
	if model == "" {
		model = "claude-3-haiku-20240307"
	}

	return &AnthropicProvider{
		config: ProviderConfig{
			Name:       "anthropic",
			BaseURL:    "https://api.anthropic.com/v1",
			APIKey:     apiKey,
			Model:      model,
			Timeout:    30 * time.Second,
			MaxRetries: 2,
		},
		client: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (p *AnthropicProvider) Name() string {
	return "anthropic"
}

func (p *AnthropicProvider) IsLocal() bool {
	return false
}

func (p *AnthropicProvider) IsAvailable() bool {
	return p.config.APIKey != ""
}

type anthropicRequest struct {
	Model     string             `json:"model"`
	MaxTokens int                `json:"max_tokens"`
	Messages  []anthropicMessage `json:"messages"`
}

type anthropicMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type anthropicResponse struct {
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

func (p *AnthropicProvider) Complete(ctx context.Context, prompt string, maxTokens int) ([]string, error) {
	if p.config.APIKey == "" {
		return nil, ErrProviderNotConfigured
	}

	reqBody := anthropicRequest{
		Model:     p.config.Model,
		MaxTokens: maxTokens,
		Messages: []anthropicMessage{
			{Role: "user", Content: "Complete this code. Return only code, no explanations:\n\n" + prompt},
		},
	}

	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, "POST", p.config.BaseURL+"/messages", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", p.config.APIKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := p.client.Do(req)
	if err != nil {
		return nil, ErrProviderUnavailable
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var anthropicResp anthropicResponse
	if err := json.Unmarshal(respBody, &anthropicResp); err != nil {
		return nil, err
	}

	if anthropicResp.Error != nil {
		return nil, errors.New(anthropicResp.Error.Message)
	}

	var completions []string
	for _, content := range anthropicResp.Content {
		if content.Type == "text" && content.Text != "" {
			completions = append(completions, content.Text)
		}
	}

	return completions, nil
}

func parseCompletions(response string) []string {
	lines := strings.Split(response, "\n")
	var completions []string

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line != "" && !strings.HasPrefix(line, "//") && !strings.HasPrefix(line, "#") {
			completions = append(completions, line)
			if len(completions) >= 5 {
				break
			}
		}
	}

	return completions
}

type ProviderManager struct {
	mu        sync.RWMutex
	providers map[string]AIProvider
	primary   string
	fallback  string
}

func NewProviderManager() *ProviderManager {
	return &ProviderManager{
		providers: make(map[string]AIProvider),
	}
}

func (m *ProviderManager) Register(provider AIProvider) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.providers[provider.Name()] = provider

	if m.primary == "" {
		if provider.IsLocal() {
			m.primary = provider.Name()
		} else if m.fallback == "" {
			m.fallback = provider.Name()
		}
	}
}

func (m *ProviderManager) SetPrimary(name string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.primary = name
}

func (m *ProviderManager) SetFallback(name string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.fallback = name
}

func (m *ProviderManager) Complete(ctx context.Context, prompt string, maxTokens int) ([]string, error) {
	m.mu.RLock()
	primary := m.providers[m.primary]
	fallback := m.providers[m.fallback]
	m.mu.RUnlock()

	if primary != nil && primary.IsAvailable() {
		results, err := primary.Complete(ctx, prompt, maxTokens)
		if err == nil {
			return results, nil
		}
	}

	if fallback != nil && fallback.IsAvailable() {
		return fallback.Complete(ctx, prompt, maxTokens)
	}

	return nil, ErrProviderUnavailable
}

func (m *ProviderManager) Get(name string) AIProvider {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.providers[name]
}

func (m *ProviderManager) List() []string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	names := make([]string, 0, len(m.providers))
	for name := range m.providers {
		names = append(names, name)
	}
	return names
}
