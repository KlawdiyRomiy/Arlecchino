package providers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
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
			Streaming:        true,
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
	ThoughtSignature string                  `json:"thoughtSignature,omitempty"`
}

type geminiFunctionCall struct {
	ID   string         `json:"id,omitempty"`
	Name string         `json:"name,omitempty"`
	Args map[string]any `json:"args,omitempty"`
}

type geminiFunctionResponse struct {
	ID       string         `json:"id,omitempty"`
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
		Content      geminiContent `json:"content"`
		FinishReason string        `json:"finishReason,omitempty"`
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
	if req.Stream && sink != nil {
		return p.generateStreaming(ctx, model, request, sink)
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
	if err := validateGeminiToolCalls(model, toolCalls); err != nil {
		return GenerationResponse{Text: text, Model: model, RawStatus: status, FinishedAt: NowString()}, err
	}
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

func (p *GeminiProvider) generateStreaming(ctx context.Context, model string, request geminiGenerateRequest, sink TokenSink) (GenerationResponse, error) {
	resp, err := postJSONRaw(ctx, p.client, p.streamingEndpoint(model), p.headers(), request)
	if err != nil {
		return GenerationResponse{}, err
	}
	defer resp.Body.Close()
	status := resp.StatusCode
	if status < 200 || status >= 300 {
		limited, _ := io.ReadAll(io.LimitReader(resp.Body, 16<<10))
		return GenerationResponse{RawStatus: status}, fmt.Errorf("provider returned HTTP %d: %s", status, strings.TrimSpace(string(limited)))
	}

	var text strings.Builder
	streamToolCalls := []GenerationToolCall{}
	var finalizedToolCalls []GenerationToolCall
	usage := GenerationTokenUsage{Source: "provider"}
	completed := false
	finishReason := ""
	result := func() GenerationResponse {
		return GenerationResponse{
			Text:       text.String(),
			Model:      model,
			RawStatus:  status,
			FinishedAt: NowString(),
			ToolCalls:  finalizedToolCalls,
			Usage:      usage,
		}
	}
	err = scanServerSentEvents(resp.Body, func(_ string, data []byte) error {
		if len(data) == 0 {
			return nil
		}
		if string(data) == "[DONE]" {
			completed = true
			return nil
		}
		var chunk geminiGenerateResponse
		if decodeErr := json.Unmarshal(data, &chunk); decodeErr != nil {
			return decodeErr
		}
		if chunk.Error != nil && strings.TrimSpace(chunk.Error.Message) != "" {
			return errors.New(chunk.Error.Message)
		}
		for _, candidate := range chunk.Candidates {
			if reason := strings.TrimSpace(candidate.FinishReason); reason != "" {
				if finishReason != "" && finishReason != reason {
					return fmt.Errorf("gemini stream changed finishReason from %q to %q", finishReason, reason)
				}
				finishReason = reason
				completed = true
				break
			}
		}
		token, calls := geminiResponseContent(chunk)
		if token != "" {
			text.WriteString(token)
			if sinkErr := sink(token); sinkErr != nil {
				return sinkErr
			}
		}
		streamToolCalls = mergeGeminiStreamToolCalls(streamToolCalls, calls)
		if chunk.UsageMetadata.PromptTokenCount > 0 {
			usage.InputTokens = chunk.UsageMetadata.PromptTokenCount
		}
		if chunk.UsageMetadata.CandidatesTokenCount > 0 {
			usage.OutputTokens = chunk.UsageMetadata.CandidatesTokenCount
		}
		if chunk.UsageMetadata.TotalTokenCount > 0 {
			usage.TotalTokens = chunk.UsageMetadata.TotalTokenCount
		} else if usage.InputTokens > 0 || usage.OutputTokens > 0 {
			usage.TotalTokens = usage.InputTokens + usage.OutputTokens
		}
		return nil
	})
	if err != nil {
		return result(), err
	}
	if !completed {
		return result(), errors.New("gemini stream ended before a finish reason")
	}
	if finishReason != "" && finishReason != "STOP" {
		return result(), fmt.Errorf("gemini stream ended incompletely with finishReason %q", finishReason)
	}
	if err := validateGeminiToolCalls(model, streamToolCalls); err != nil {
		return result(), err
	}
	finalizedToolCalls = streamToolCalls
	return result(), nil
}

func (p *GeminiProvider) generateEndpoint(model string) string {
	model = strings.TrimPrefix(strings.TrimSpace(model), "models/")
	return p.endpoint + "/models/" + url.PathEscape(model) + ":generateContent"
}

func (p *GeminiProvider) streamingEndpoint(model string) string {
	model = strings.TrimPrefix(strings.TrimSpace(model), "models/")
	return p.endpoint + "/models/" + url.PathEscape(model) + ":streamGenerateContent?alt=sse"
}

func generationToolCallBatchKey(call GenerationToolCall) string {
	if id := strings.TrimSpace(call.ID); id != "" {
		return "id:" + id
	}
	if call.ProviderIndex != nil {
		return fmt.Sprintf("index:%d:%s:%s:%s", *call.ProviderIndex, call.Name, call.ArgumentsJSON, call.ThoughtSignature)
	}
	return "value:" + call.Name + "\x00" + call.ArgumentsJSON + "\x00" + call.ThoughtSignature
}

func validateGeminiToolCalls(model string, calls []GenerationToolCall) error {
	if err := validateGenerationToolCalls(calls); err != nil {
		return err
	}
	if len(calls) > 0 && strings.Contains(strings.ToLower(model), "gemini-3") && strings.TrimSpace(calls[0].ThoughtSignature) == "" {
		return errors.New("gemini 3 function call is missing its required thoughtSignature")
	}
	return nil
}

func appendUniqueGenerationToolCalls(existing []GenerationToolCall, incoming ...GenerationToolCall) []GenerationToolCall {
	existingCounts := make(map[string]int, len(existing))
	for _, call := range existing {
		existingCounts[generationToolCallBatchKey(call)]++
	}
	incomingCounts := make(map[string]int, len(incoming))
	for _, call := range incoming {
		key := generationToolCallBatchKey(call)
		incomingCounts[key]++
		if incomingCounts[key] <= existingCounts[key] {
			continue
		}
		existing = append(existing, call)
	}
	return existing
}

func mergeGeminiStreamToolCalls(existing []GenerationToolCall, incoming []GenerationToolCall) []GenerationToolCall {
	unidentified := make([]GenerationToolCall, 0, len(incoming))
	for _, call := range incoming {
		match := -1
		if id := strings.TrimSpace(call.ID); id != "" {
			for index := range existing {
				if strings.TrimSpace(existing[index].ID) == id {
					match = index
					break
				}
			}
		} else if call.ProviderIndex != nil {
			for index := range existing {
				if strings.TrimSpace(existing[index].ID) == "" && existing[index].ProviderIndex != nil && *existing[index].ProviderIndex == *call.ProviderIndex {
					match = index
					break
				}
			}
		} else {
			unidentified = append(unidentified, call)
			continue
		}
		if match >= 0 {
			existing[match] = call
		} else {
			existing = append(existing, call)
		}
	}
	return appendUniqueGenerationToolCalls(existing, unidentified...)
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
			responsePart := geminiPart{
				FunctionResponse: &geminiFunctionResponse{
					ID:       strings.TrimSpace(message.ToolCallID),
					Name:     strings.TrimSpace(message.Name),
					Response: geminiToolResponse(message.Content),
				},
			}
			if len(contents) > 0 && geminiContentContainsOnlyFunctionResponses(contents[len(contents)-1]) {
				contents[len(contents)-1].Parts = append(contents[len(contents)-1].Parts, responsePart)
				continue
			}
			contents = append(contents, geminiContent{Role: "user", Parts: []geminiPart{responsePart}})
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

func geminiContentContainsOnlyFunctionResponses(content geminiContent) bool {
	if content.Role != "user" || len(content.Parts) == 0 {
		return false
	}
	for _, part := range content.Parts {
		if part.FunctionResponse == nil {
			return false
		}
	}
	return true
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
		parts = append(parts, geminiPart{
			FunctionCall: &geminiFunctionCall{
				ID:   strings.TrimSpace(call.ID),
				Name: name,
				Args: args,
			},
			ThoughtSignature: call.ThoughtSignature,
		})
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
	for partIndex, part := range response.Candidates[0].Content.Parts {
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
			index := partIndex
			toolCalls = append(toolCalls, GenerationToolCall{
				ID:               strings.TrimSpace(part.FunctionCall.ID),
				Name:             strings.TrimSpace(part.FunctionCall.Name),
				ArgumentsJSON:    arguments,
				ProviderIndex:    &index,
				ThoughtSignature: part.ThoughtSignature,
			})
		}
	}
	return text.String(), toolCalls
}
