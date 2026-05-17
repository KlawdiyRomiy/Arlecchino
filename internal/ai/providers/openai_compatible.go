package providers

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	DefaultLMStudioEndpoint = "http://127.0.0.1:1234/v1"
	DefaultLlamaEndpoint    = "http://127.0.0.1:8080/v1"
	DefaultTGIEndpoint      = "http://127.0.0.1:3000/v1"
)

type OpenAICompatibleProvider struct {
	id           string
	name         string
	kind         string
	endpoint     string
	model        string
	manual       bool
	local        bool
	requiresAuth bool
	secret       string
	client       *http.Client
}

type OpenAICompatibleOptions struct {
	ID           string
	Name         string
	Kind         string
	Endpoint     string
	Model        string
	Manual       bool
	Local        bool
	RequiresAuth bool
	Secret       string
	Timeout      time.Duration
}

func NewOpenAICompatibleProvider(opts OpenAICompatibleOptions) *OpenAICompatibleProvider {
	if strings.TrimSpace(opts.ID) == "" {
		opts.ID = strings.TrimSpace(opts.Kind) + "-local"
	}
	if strings.TrimSpace(opts.Name) == "" {
		opts.Name = opts.Kind
	}
	return &OpenAICompatibleProvider{
		id:           strings.TrimSpace(opts.ID),
		name:         strings.TrimSpace(opts.Name),
		kind:         strings.TrimSpace(opts.Kind),
		endpoint:     normalizeEndpoint(opts.Endpoint, ""),
		model:        strings.TrimSpace(opts.Model),
		manual:       opts.Manual,
		local:        opts.Local,
		requiresAuth: opts.RequiresAuth,
		secret:       strings.TrimSpace(opts.Secret),
		client:       newHTTPClient(opts.Timeout),
	}
}

func (p *OpenAICompatibleProvider) Descriptor() AIProviderDescriptor {
	status := ProviderStatusDiscovered
	authConfigured := !p.requiresAuth || p.secret != ""
	authMode := ProviderAuthModeNone
	if p.requiresAuth {
		authMode = ProviderAuthModeAPIKey
	}
	if p.requiresAuth && !authConfigured {
		status = ProviderStatusNeedsAuth
	}
	return AIProviderDescriptor{
		ID:             p.id,
		Name:           p.name,
		Kind:           p.kind,
		Endpoint:       p.endpoint,
		Local:          p.local,
		Manual:         p.manual,
		Frontier:       !p.local,
		AuthMode:       authMode,
		OAuthSupported: !p.local,
		RequiresAuth:   p.requiresAuth,
		AuthConfigured: authConfigured,
		Capabilities:   DefaultCapabilities(),
		DefaultModel:   p.model,
		Status:         status,
	}
}

type openAIModelsResponse struct {
	Data []struct {
		ID string `json:"id"`
	} `json:"data"`
}

func (p *OpenAICompatibleProvider) headers() map[string]string {
	if p.secret == "" {
		return nil
	}
	return map[string]string{"Authorization": "Bearer " + p.secret}
}

func (p *OpenAICompatibleProvider) ListModels(ctx context.Context) ([]AIModelDescriptor, error) {
	if p.endpoint == "" {
		return nil, fmt.Errorf("provider endpoint is empty")
	}
	var response openAIModelsResponse
	if _, err := getJSON(ctx, p.client, p.endpoint+"/models", p.headers(), &response); err != nil {
		return nil, err
	}
	models := make([]AIModelDescriptor, 0, len(response.Data))
	for _, model := range response.Data {
		id := strings.TrimSpace(model.ID)
		if id == "" {
			continue
		}
		models = append(models, AIModelDescriptor{
			ID:          id,
			DisplayName: id,
			Streaming:   true,
		})
	}
	return models, nil
}

func (p *OpenAICompatibleProvider) HealthCheck(ctx context.Context) AIProviderDescriptor {
	descriptor := p.Descriptor()
	descriptor.LastCheckedAt = NowString()
	if p.requiresAuth && p.secret == "" {
		descriptor.Status = ProviderStatusNeedsAuth
		descriptor.Reason = "provider requires an API key"
		return descriptor
	}
	models, err := p.ListModels(ctx)
	if err != nil {
		descriptor.Status = ProviderStatusError
		descriptor.Reason = err.Error()
		return descriptor
	}
	descriptor.Models = models
	descriptor.Status = ProviderStatusReady
	if descriptor.DefaultModel == "" && len(models) > 0 {
		descriptor.DefaultModel = models[0].ID
	}
	return descriptor
}

type openAIChatRequest struct {
	Model       string          `json:"model"`
	Messages    []openAIMessage `json:"messages"`
	MaxTokens   int             `json:"max_tokens,omitempty"`
	Temperature float64         `json:"temperature,omitempty"`
	Stop        []string        `json:"stop,omitempty"`
	Stream      bool            `json:"stream"`
}

type openAIMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openAIChatResponse struct {
	Choices []struct {
		Message openAIChoiceMessage `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

type openAIChoiceMessage struct {
	Content          string `json:"content"`
	ReasoningContent string `json:"reasoning_content"`
	Reasoning        string `json:"reasoning"`
	Thinking         string `json:"thinking"`
}

func (p *OpenAICompatibleProvider) Generate(ctx context.Context, req GenerationRequest, sink TokenSink) (GenerationResponse, error) {
	if p.requiresAuth && p.secret == "" {
		return GenerationResponse{}, fmt.Errorf("provider requires an API key")
	}
	model := strings.TrimSpace(req.Model)
	if model == "" {
		model = p.model
	}
	if model == "" {
		return GenerationResponse{}, fmt.Errorf("provider model is not configured")
	}
	maxTokens := req.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 256
	}
	temperature := req.Temperature
	if temperature <= 0 {
		temperature = 0.2
	}
	request := openAIChatRequest{
		Model:       model,
		Messages:    openAIMessagesFromGenerationRequest(req),
		MaxTokens:   maxTokens,
		Temperature: temperature,
		Stop:        req.Stop,
		Stream:      req.Stream && sink != nil,
	}
	if request.Stream {
		return p.generateStreaming(ctx, request, sink)
	}

	var response openAIChatResponse
	status, err := postJSON(ctx, p.client, p.endpoint+"/chat/completions", p.headers(), request, &response)
	if err != nil {
		return GenerationResponse{RawStatus: status}, err
	}
	if response.Error != nil && strings.TrimSpace(response.Error.Message) != "" {
		return GenerationResponse{RawStatus: status}, errors.New(response.Error.Message)
	}
	text := ""
	reasoningText := ""
	if len(response.Choices) > 0 {
		text = response.Choices[0].Message.Content
		reasoningText = openAIReasoningText(response.Choices[0].Message)
	}
	if sink != nil && text != "" {
		if err := sink(text); err != nil {
			return GenerationResponse{Text: text, ReasoningText: reasoningText, Model: model, RawStatus: status, FinishedAt: NowString()}, err
		}
	}
	return GenerationResponse{Text: text, ReasoningText: reasoningText, Model: model, RawStatus: status, FinishedAt: NowString()}, nil
}

type openAIStreamChunk struct {
	Choices []struct {
		Delta   openAIChoiceMessage `json:"delta"`
		Message openAIChoiceMessage `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func openAIMessagesFromGenerationRequest(req GenerationRequest) []openAIMessage {
	messages := []openAIMessage{}
	if len(req.Messages) > 0 {
		if strings.TrimSpace(req.System) != "" && !generationMessagesContainSystem(req.Messages) {
			messages = append(messages, openAIMessage{Role: "system", Content: req.System})
		}
		for _, message := range req.Messages {
			role := normalizedOpenAIMessageRole(message.Role)
			content := strings.TrimSpace(message.Content)
			if content == "" {
				continue
			}
			messages = append(messages, openAIMessage{Role: role, Content: content})
		}
		if len(messages) > 0 {
			return messages
		}
	}
	if strings.TrimSpace(req.System) != "" {
		messages = append(messages, openAIMessage{Role: "system", Content: req.System})
	}
	if strings.TrimSpace(req.Prompt) != "" {
		messages = append(messages, openAIMessage{Role: "user", Content: req.Prompt})
	}
	return messages
}

func generationMessagesContainSystem(messages []GenerationMessage) bool {
	for _, message := range messages {
		if normalizedOpenAIMessageRole(message.Role) == "system" && strings.TrimSpace(message.Content) != "" {
			return true
		}
	}
	return false
}

func normalizedOpenAIMessageRole(role string) string {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "system", "assistant", "user":
		return strings.ToLower(strings.TrimSpace(role))
	default:
		return "user"
	}
}

func openAIReasoningText(message openAIChoiceMessage) string {
	return firstNonEmptyString(message.ReasoningContent, message.Reasoning, message.Thinking)
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func (p *OpenAICompatibleProvider) generateStreaming(ctx context.Context, request openAIChatRequest, sink TokenSink) (GenerationResponse, error) {
	resp, err := postJSONRaw(ctx, p.client, p.endpoint+"/chat/completions", p.headers(), request)
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
	var reasoningBuilder strings.Builder
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 4096), maxProviderResponseBytes)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		if strings.HasPrefix(line, "data:") {
			line = strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		}
		if line == "[DONE]" {
			break
		}
		var chunk openAIStreamChunk
		if err := json.Unmarshal([]byte(line), &chunk); err != nil {
			continue
		}
		if chunk.Error != nil && strings.TrimSpace(chunk.Error.Message) != "" {
			return GenerationResponse{Text: builder.String(), Model: request.Model, RawStatus: status, FinishedAt: NowString()}, errors.New(chunk.Error.Message)
		}
		if len(chunk.Choices) == 0 {
			continue
		}
		token := chunk.Choices[0].Delta.Content
		if token == "" {
			token = chunk.Choices[0].Message.Content
		}
		reasoningToken := openAIReasoningText(chunk.Choices[0].Delta)
		if reasoningToken == "" {
			reasoningToken = openAIReasoningText(chunk.Choices[0].Message)
		}
		if reasoningToken != "" {
			reasoningBuilder.WriteString(reasoningToken)
		}
		if token == "" {
			continue
		}
		builder.WriteString(token)
		if err := sink(token); err != nil {
			return GenerationResponse{Text: builder.String(), ReasoningText: reasoningBuilder.String(), Model: request.Model, RawStatus: status, FinishedAt: NowString()}, err
		}
	}
	if err := scanner.Err(); err != nil {
		return GenerationResponse{Text: builder.String(), ReasoningText: reasoningBuilder.String(), Model: request.Model, RawStatus: status, FinishedAt: NowString()}, err
	}
	return GenerationResponse{Text: builder.String(), ReasoningText: reasoningBuilder.String(), Model: request.Model, RawStatus: status, FinishedAt: NowString()}, nil
}
