package providers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const DefaultGeminiEndpoint = "https://generativelanguage.googleapis.com/v1beta"

type GeminiProvider struct {
	id            string
	name          string
	kind          string
	endpoint      string
	model         string
	manual        bool
	frontier      bool
	endpointClass string
	secret        string
	client        *http.Client
}

type GeminiOptions struct {
	ID            string
	Name          string
	Kind          string
	Endpoint      string
	Model         string
	Manual        bool
	Frontier      bool
	EndpointClass string
	Secret        string
	Timeout       time.Duration
}

func NewGeminiProvider(opts GeminiOptions) *GeminiProvider {
	if strings.TrimSpace(opts.ID) == "" {
		opts.ID = "google-gemini-frontier"
	}
	if strings.TrimSpace(opts.Name) == "" {
		opts.Name = "Google Gemini"
	}
	if strings.TrimSpace(opts.Kind) == "" {
		opts.Kind = "google-gemini"
	}
	return &GeminiProvider{
		id:            strings.TrimSpace(opts.ID),
		name:          strings.TrimSpace(opts.Name),
		kind:          strings.TrimSpace(opts.Kind),
		endpoint:      normalizeEndpoint(opts.Endpoint, DefaultGeminiEndpoint),
		model:         strings.TrimSpace(opts.Model),
		manual:        opts.Manual,
		frontier:      opts.Frontier || strings.TrimSpace(opts.EndpointClass) == "",
		endpointClass: strings.TrimSpace(opts.EndpointClass),
		secret:        strings.TrimSpace(opts.Secret),
		client:        newHTTPClient(opts.Timeout),
	}
}

func (p *GeminiProvider) Descriptor() AIProviderDescriptor {
	status := ProviderStatusDiscovered
	if p.secret == "" {
		status = ProviderStatusNeedsAuth
	}
	return AIProviderDescriptor{
		ID:                 p.id,
		Name:               p.name,
		Kind:               p.kind,
		RuntimeFamily:      "model_agent_runtime",
		Transport:          "model_api",
		Endpoint:           p.endpoint,
		EndpointClass:      firstNonEmptyString(p.endpointClass, "frontier"),
		AdapterVersion:     "arlecchino-gemini-runtime-v1",
		ProtocolVersion:    "google_generative_language_v1beta",
		CompatibilityRange: "gemini_generate_content",
		Local:              false,
		Manual:             p.manual,
		Frontier:           p.frontier,
		AuthMode:           ProviderAuthModeAPIKey,
		OAuthSupported:     false,
		RequiresAuth:       true,
		AuthConfigured:     p.secret != "",
		Capabilities:       CloudCapabilities(),
		DefaultModel:       p.model,
		Status:             status,
		BillingMode:        "byok",
		LegalBasis:         "official_provider_api_key",
		RiskTier:           "frontier_byok",
	}
}

type geminiModelsResponse struct {
	Models []struct {
		Name             string   `json:"name"`
		DisplayName      string   `json:"displayName"`
		SupportedMethods []string `json:"supportedGenerationMethods"`
		InputTokenLimit  int      `json:"inputTokenLimit"`
	} `json:"models"`
}

func (p *GeminiProvider) headers() map[string]string {
	headers := map[string]string{}
	if p.secret != "" {
		headers["x-goog-api-key"] = p.secret
	}
	return headers
}

func (p *GeminiProvider) ListModels(ctx context.Context) ([]AIModelDescriptor, error) {
	if p.secret == "" {
		return nil, fmt.Errorf("provider requires an API key")
	}
	var response geminiModelsResponse
	if _, err := getJSON(ctx, p.client, p.endpoint+"/models", p.headers(), &response); err != nil {
		return nil, err
	}
	models := make([]AIModelDescriptor, 0, len(response.Models))
	for _, model := range response.Models {
		id := strings.TrimPrefix(strings.TrimSpace(model.Name), "models/")
		if id == "" || !geminiSupportsGenerateContent(model.SupportedMethods) {
			continue
		}
		models = append(models, EnrichModelDescriptor(p.kind, AIModelDescriptor{
			ID:               id,
			DisplayName:      firstNonEmptyString(model.DisplayName, id),
			ContextWindow:    model.InputTokenLimit,
			Streaming:        false,
			ToolCalling:      true,
			StructuredOutput: true,
			PatchGeneration:  true,
		}))
	}
	return models, nil
}

func geminiSupportsGenerateContent(methods []string) bool {
	for _, method := range methods {
		if strings.EqualFold(strings.TrimSpace(method), "generateContent") {
			return true
		}
	}
	return len(methods) == 0
}

func (p *GeminiProvider) HealthCheck(ctx context.Context) AIProviderDescriptor {
	descriptor := p.Descriptor()
	descriptor.LastCheckedAt = NowString()
	if p.secret == "" {
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

type geminiGenerateRequest struct {
	Contents          []geminiContent         `json:"contents"`
	SystemInstruction *geminiContent          `json:"systemInstruction,omitempty"`
	GenerationConfig  *geminiGenerationConfig `json:"generationConfig,omitempty"`
	Tools             []geminiTool            `json:"tools,omitempty"`
	ToolConfig        any                     `json:"toolConfig,omitempty"`
}

type geminiGenerationConfig struct {
	MaxOutputTokens int     `json:"maxOutputTokens,omitempty"`
	Temperature     float64 `json:"temperature,omitempty"`
}

type geminiContent struct {
	Role  string       `json:"role,omitempty"`
	Parts []geminiPart `json:"parts"`
}

type geminiPart struct {
	Text             string                  `json:"text,omitempty"`
	FunctionCall     *geminiFunctionCall     `json:"functionCall,omitempty"`
	FunctionResponse *geminiFunctionResponse `json:"functionResponse,omitempty"`
}

type geminiFunctionCall struct {
	Name string         `json:"name,omitempty"`
	Args map[string]any `json:"args,omitempty"`
}

type geminiFunctionResponse struct {
	Name     string         `json:"name,omitempty"`
	Response map[string]any `json:"response,omitempty"`
}

type geminiTool struct {
	FunctionDeclarations []geminiFunctionDeclaration `json:"functionDeclarations,omitempty"`
}

type geminiFunctionDeclaration struct {
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	Parameters  map[string]any `json:"parameters,omitempty"`
}

type geminiGenerateResponse struct {
	Candidates []struct {
		Content geminiContent `json:"content"`
	} `json:"candidates"`
	UsageMetadata struct {
		PromptTokenCount     int `json:"promptTokenCount"`
		CandidatesTokenCount int `json:"candidatesTokenCount"`
		TotalTokenCount      int `json:"totalTokenCount"`
	} `json:"usageMetadata,omitempty"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func (p *GeminiProvider) Generate(ctx context.Context, req GenerationRequest, sink TokenSink) (GenerationResponse, error) {
	if p.secret == "" {
		return GenerationResponse{}, fmt.Errorf("provider requires an API key")
	}
	model := firstNonEmptyString(req.Model, p.model)
	if model == "" {
		return GenerationResponse{}, fmt.Errorf("provider model is not configured")
	}
	request := geminiGenerateRequest{
		Contents: geminiContentsFromGenerationRequest(req),
		GenerationConfig: &geminiGenerationConfig{
			MaxOutputTokens: req.MaxTokens,
			Temperature:     req.Temperature,
		},
		Tools:      geminiToolsFromGenerationRequest(req.Tools),
		ToolConfig: geminiToolConfig(req.ToolChoice, req.Tools),
	}
	if strings.TrimSpace(req.System) != "" {
		request.SystemInstruction = &geminiContent{Parts: []geminiPart{{Text: strings.TrimSpace(req.System)}}}
	}
	var response geminiGenerateResponse
	status, err := postJSON(ctx, p.client, p.generateEndpoint(model), p.headers(), request, &response)
	if err != nil {
		return GenerationResponse{RawStatus: status}, err
	}
	if response.Error != nil && strings.TrimSpace(response.Error.Message) != "" {
		return GenerationResponse{RawStatus: status}, errors.New(response.Error.Message)
	}
	text, toolCalls := geminiResponseContent(response)
	if sink != nil && text != "" {
		if err := sink(text); err != nil {
			return GenerationResponse{Text: text, Model: model, RawStatus: status, FinishedAt: NowString()}, err
		}
	}
	return GenerationResponse{
		Text:       text,
		Model:      model,
		RawStatus:  status,
		FinishedAt: NowString(),
		ToolCalls:  toolCalls,
		Usage: GenerationTokenUsage{
			InputTokens:  response.UsageMetadata.PromptTokenCount,
			OutputTokens: response.UsageMetadata.CandidatesTokenCount,
			TotalTokens:  response.UsageMetadata.TotalTokenCount,
			Source:       "provider",
		},
	}, nil
}

func (p *GeminiProvider) generateEndpoint(model string) string {
	model = strings.TrimPrefix(strings.TrimSpace(model), "models/")
	return p.endpoint + "/models/" + url.PathEscape(model) + ":generateContent"
}

func geminiContentsFromGenerationRequest(req GenerationRequest) []geminiContent {
	if len(req.Messages) == 0 {
		if strings.TrimSpace(req.Prompt) == "" {
			return []geminiContent{}
		}
		return []geminiContent{{Role: "user", Parts: []geminiPart{{Text: req.Prompt}}}}
	}
	contents := make([]geminiContent, 0, len(req.Messages))
	for _, message := range req.Messages {
		if strings.ToLower(strings.TrimSpace(message.Role)) == "system" {
			continue
		}
		if len(message.ToolCalls) > 0 {
			contents = append(contents, geminiContent{Role: "model", Parts: geminiFunctionCallParts(message.ToolCalls)})
			continue
		}
		if strings.TrimSpace(message.ToolCallID) != "" {
			contents = append(contents, geminiContent{Role: "function", Parts: []geminiPart{{
				FunctionResponse: &geminiFunctionResponse{
					Name:     strings.TrimSpace(message.Name),
					Response: geminiToolResponse(message.Content),
				},
			}}})
			continue
		}
		content := strings.TrimSpace(message.Content)
		if content == "" {
			continue
		}
		role := "user"
		if strings.ToLower(strings.TrimSpace(message.Role)) == "assistant" {
			role = "model"
		}
		contents = append(contents, geminiContent{Role: role, Parts: []geminiPart{{Text: content}}})
	}
	return contents
}

func geminiFunctionCallParts(calls []GenerationToolCall) []geminiPart {
	parts := make([]geminiPart, 0, len(calls))
	for _, call := range calls {
		name := strings.TrimSpace(call.Name)
		if name == "" {
			continue
		}
		args := map[string]any{}
		if raw := strings.TrimSpace(call.ArgumentsJSON); raw != "" {
			_ = json.Unmarshal([]byte(raw), &args)
		}
		parts = append(parts, geminiPart{FunctionCall: &geminiFunctionCall{Name: name, Args: args}})
	}
	return parts
}

func geminiToolResponse(content string) map[string]any {
	response := map[string]any{}
	if raw := strings.TrimSpace(content); raw != "" {
		if err := json.Unmarshal([]byte(raw), &response); err == nil {
			return response
		}
		response["content"] = raw
	}
	return response
}

func geminiToolsFromGenerationRequest(tools []GenerationTool) []geminiTool {
	if len(tools) == 0 {
		return nil
	}
	declarations := make([]geminiFunctionDeclaration, 0, len(tools))
	for _, tool := range tools {
		name := strings.TrimSpace(tool.Name)
		if name == "" {
			continue
		}
		parameters := tool.Parameters
		if parameters == nil {
			parameters = map[string]any{"type": "object"}
		}
		declarations = append(declarations, geminiFunctionDeclaration{Name: name, Description: strings.TrimSpace(tool.Description), Parameters: parameters})
	}
	if len(declarations) == 0 {
		return nil
	}
	return []geminiTool{{FunctionDeclarations: declarations}}
}

func geminiToolConfig(choice string, tools []GenerationTool) any {
	if len(tools) == 0 {
		return nil
	}
	if strings.TrimSpace(choice) == "required" {
		names := make([]string, 0, len(tools))
		for _, tool := range tools {
			if name := strings.TrimSpace(tool.Name); name != "" {
				names = append(names, name)
			}
		}
		if len(names) > 0 {
			return map[string]any{"functionCallingConfig": map[string]any{"mode": "ANY", "allowedFunctionNames": names}}
		}
	}
	return map[string]any{"functionCallingConfig": map[string]any{"mode": "AUTO"}}
}

func geminiResponseContent(response geminiGenerateResponse) (string, []GenerationToolCall) {
	var text strings.Builder
	toolCalls := []GenerationToolCall{}
	if len(response.Candidates) == 0 {
		return "", nil
	}
	for _, part := range response.Candidates[0].Content.Parts {
		if part.Text != "" {
			text.WriteString(part.Text)
		}
		if part.FunctionCall != nil && strings.TrimSpace(part.FunctionCall.Name) != "" {
			arguments := "{}"
			if part.FunctionCall.Args != nil {
				if encoded, err := json.Marshal(part.FunctionCall.Args); err == nil {
					arguments = string(encoded)
				}
			}
			toolCalls = append(toolCalls, GenerationToolCall{Name: strings.TrimSpace(part.FunctionCall.Name), ArgumentsJSON: arguments})
		}
	}
	return text.String(), toolCalls
}
