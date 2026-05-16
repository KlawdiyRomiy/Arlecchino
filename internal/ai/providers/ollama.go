package providers

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const DefaultOllamaEndpoint = "http://127.0.0.1:11434"

type OllamaProvider struct {
	id       string
	name     string
	endpoint string
	model    string
	manual   bool
	client   *http.Client
}

func NewOllamaProvider(id string, endpoint string, model string, manual bool, timeout time.Duration) *OllamaProvider {
	if strings.TrimSpace(id) == "" {
		id = "ollama-local"
	}
	if strings.TrimSpace(model) == "" {
		model = "codellama:7b-code"
	}
	return &OllamaProvider{
		id:       id,
		name:     "Ollama",
		endpoint: normalizeEndpoint(endpoint, DefaultOllamaEndpoint),
		model:    strings.TrimSpace(model),
		manual:   manual,
		client:   newHTTPClient(timeout),
	}
}

func (p *OllamaProvider) Descriptor() AIProviderDescriptor {
	return AIProviderDescriptor{
		ID:           p.id,
		Name:         p.name,
		Kind:         "ollama",
		Endpoint:     p.endpoint,
		Local:        true,
		Manual:       p.manual,
		AuthMode:     ProviderAuthModeNone,
		Capabilities: DefaultCapabilities(),
		DefaultModel: p.model,
		Status:       ProviderStatusDiscovered,
	}
}

type ollamaTagsResponse struct {
	Models []struct {
		Name       string `json:"name"`
		ModifiedAt string `json:"modified_at"`
		Details    struct {
			ParameterSize string `json:"parameter_size"`
		} `json:"details"`
	} `json:"models"`
}

func (p *OllamaProvider) ListModels(ctx context.Context) ([]AIModelDescriptor, error) {
	var response ollamaTagsResponse
	if _, err := getJSON(ctx, p.client, p.endpoint+"/api/tags", nil, &response); err != nil {
		return nil, err
	}
	models := make([]AIModelDescriptor, 0, len(response.Models))
	for _, model := range response.Models {
		name := strings.TrimSpace(model.Name)
		if name == "" {
			continue
		}
		models = append(models, AIModelDescriptor{
			ID:          name,
			DisplayName: name,
			Streaming:   true,
		})
	}
	return models, nil
}

func (p *OllamaProvider) HealthCheck(ctx context.Context) AIProviderDescriptor {
	descriptor := p.Descriptor()
	models, err := p.ListModels(ctx)
	descriptor.LastCheckedAt = NowString()
	if err != nil {
		descriptor.Status = ProviderStatusError
		descriptor.Reason = err.Error()
		return descriptor
	}
	descriptor.Models = models
	descriptor.Status = ProviderStatusReady
	if len(models) > 0 && strings.TrimSpace(p.model) == "" {
		descriptor.DefaultModel = models[0].ID
	}
	return descriptor
}

type ollamaGenerateRequest struct {
	Model   string         `json:"model"`
	Prompt  string         `json:"prompt"`
	System  string         `json:"system,omitempty"`
	Stream  bool           `json:"stream"`
	Options map[string]any `json:"options,omitempty"`
}

type ollamaGenerateResponse struct {
	Response string `json:"response"`
	Done     bool   `json:"done"`
	Model    string `json:"model"`
}

func (p *OllamaProvider) Generate(ctx context.Context, req GenerationRequest, sink TokenSink) (GenerationResponse, error) {
	model := strings.TrimSpace(req.Model)
	if model == "" {
		model = p.model
	}
	if model == "" {
		return GenerationResponse{}, fmt.Errorf("ollama model is not configured")
	}
	maxTokens := req.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 256
	}
	temperature := req.Temperature
	if temperature <= 0 {
		temperature = 0.2
	}
	request := ollamaGenerateRequest{
		Model:  model,
		Prompt: req.Prompt,
		System: req.System,
		Stream: req.Stream && sink != nil,
		Options: map[string]any{
			"num_predict": maxTokens,
			"temperature": temperature,
		},
	}
	if len(req.Stop) > 0 {
		request.Options["stop"] = req.Stop
	}
	if request.Stream {
		return p.generateStreaming(ctx, request, sink)
	}

	var response ollamaGenerateResponse
	status, err := postJSON(ctx, p.client, p.endpoint+"/api/generate", nil, request, &response)
	if err != nil {
		return GenerationResponse{RawStatus: status}, err
	}
	text := response.Response
	if sink != nil && text != "" {
		if err := sink(text); err != nil {
			return GenerationResponse{Text: text, Model: model, RawStatus: status, FinishedAt: NowString()}, err
		}
	}
	return GenerationResponse{Text: text, Model: model, RawStatus: status, FinishedAt: NowString()}, nil
}

func (p *OllamaProvider) generateStreaming(ctx context.Context, request ollamaGenerateRequest, sink TokenSink) (GenerationResponse, error) {
	resp, err := postJSONRaw(ctx, p.client, p.endpoint+"/api/generate", nil, request)
	if err != nil {
		return GenerationResponse{}, err
	}
	defer resp.Body.Close()
	status := resp.StatusCode
	if status < 200 || status >= 300 {
		limited, _ := io.ReadAll(io.LimitReader(resp.Body, 16<<10))
		return GenerationResponse{RawStatus: status}, fmt.Errorf("provider returned HTTP %d: %s", status, strings.TrimSpace(string(limited)))
	}
	var builder strings.Builder
	model := request.Model
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 4096), maxProviderResponseBytes)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var chunk ollamaGenerateResponse
		if err := json.Unmarshal([]byte(line), &chunk); err != nil {
			continue
		}
		if strings.TrimSpace(chunk.Model) != "" {
			model = chunk.Model
		}
		if chunk.Response != "" {
			builder.WriteString(chunk.Response)
			if err := sink(chunk.Response); err != nil {
				return GenerationResponse{Text: builder.String(), Model: model, RawStatus: status, FinishedAt: NowString()}, err
			}
		}
		if chunk.Done {
			break
		}
	}
	if err := scanner.Err(); err != nil {
		return GenerationResponse{Text: builder.String(), Model: model, RawStatus: status, FinishedAt: NowString()}, err
	}
	return GenerationResponse{Text: builder.String(), Model: model, RawStatus: status, FinishedAt: NowString()}, nil
}
