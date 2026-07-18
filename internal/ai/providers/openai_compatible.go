package providers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
)

const (
	DefaultLMStudioEndpoint   = "http://127.0.0.1:1234/v1"
	DefaultLlamaEndpoint      = "http://127.0.0.1:8080/v1"
	DefaultTGIEndpoint        = "http://127.0.0.1:3000/v1"
	DefaultOpenAIEndpoint     = "https://api.openai.com/v1"
	DefaultOpenRouterEndpoint = "https://openrouter.ai/api/v1"
)

type OpenAICompatibleProvider struct {
	id            string
	name          string
	kind          string
	endpoint      string
	model         string
	manual        bool
	local         bool
	frontier      bool
	endpointClass string
	requiresAuth  bool
	secret        string
	client        *http.Client
}

type OpenAICompatibleOptions struct {
	ID            string
	Name          string
	Kind          string
	Endpoint      string
	Model         string
	Manual        bool
	Local         bool
	Frontier      bool
	EndpointClass string
	RequiresAuth  bool
	Secret        string
	Timeout       time.Duration
}

func NewOpenAICompatibleProvider(opts OpenAICompatibleOptions) *OpenAICompatibleProvider {
	if strings.TrimSpace(opts.ID) == "" {
		opts.ID = strings.TrimSpace(opts.Kind) + "-local"
	}
	if strings.TrimSpace(opts.Name) == "" {
		opts.Name = opts.Kind
	}
	return &OpenAICompatibleProvider{
		id:            strings.TrimSpace(opts.ID),
		name:          strings.TrimSpace(opts.Name),
		kind:          strings.TrimSpace(opts.Kind),
		endpoint:      normalizeEndpoint(opts.Endpoint, ""),
		model:         strings.TrimSpace(opts.Model),
		manual:        opts.Manual,
		local:         opts.Local,
		frontier:      opts.Frontier || (!opts.Local && strings.TrimSpace(opts.EndpointClass) == ""),
		endpointClass: strings.TrimSpace(opts.EndpointClass),
		requiresAuth:  opts.RequiresAuth,
		secret:        strings.TrimSpace(opts.Secret),
		client:        newHTTPClient(opts.Timeout),
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
	capabilities := DefaultCapabilities()
	if !p.local {
		capabilities = append(capabilities,
			CapabilityToolCalling,
			CapabilityStructuredOutput,
			CapabilityPatchGeneration,
		)
	}
	return AIProviderDescriptor{
		ID:                 p.id,
		Name:               p.name,
		Kind:               p.kind,
		RuntimeFamily:      "model_agent_runtime",
		Transport:          "model_api",
		Endpoint:           p.endpoint,
		EndpointClass:      openAICompatibleEndpointClass(p.local, p.endpointClass),
		AdapterVersion:     "arlecchino-model-runtime-v1",
		ProtocolVersion:    "openai_compatible_http_sse",
		CompatibilityRange: "openai_compatible_chat_completions",
		Local:              p.local,
		Manual:             p.manual,
		Frontier:           p.frontier,
		AuthMode:           authMode,
		OAuthSupported:     false,
		RequiresAuth:       p.requiresAuth,
		AuthConfigured:     authConfigured,
		Capabilities:       capabilities,
		DefaultModel:       p.model,
		Status:             status,
	}
}

func openAICompatibleEndpointClass(local bool, endpointClass string) string {
	if strings.TrimSpace(endpointClass) != "" {
		return strings.TrimSpace(endpointClass)
	}
	if local {
		return "loopback"
	}
	return "frontier"
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
		models = append(models, EnrichModelDescriptor(p.kind, AIModelDescriptor{
			ID:          id,
			DisplayName: id,
			Streaming:   true,
		}))
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
	Tools       []openAITool    `json:"tools,omitempty"`
	ToolChoice  any             `json:"tool_choice,omitempty"`
}

type openAIMessage struct {
	Role       string           `json:"role"`
	Content    string           `json:"content,omitempty"`
	ToolCallID string           `json:"tool_call_id,omitempty"`
	Name       string           `json:"name,omitempty"`
	ToolCalls  []openAIToolCall `json:"tool_calls,omitempty"`
}

type openAITool struct {
	Type     string         `json:"type"`
	Function openAIFunction `json:"function"`
}

type openAIFunction struct {
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	Parameters  map[string]any `json:"parameters,omitempty"`
}

type openAIToolCall struct {
	Index    *int                   `json:"index,omitempty"`
	ID       string                 `json:"id,omitempty"`
	Type     string                 `json:"type,omitempty"`
	Function openAIToolCallFunction `json:"function"`
}

type openAIToolCallFunction struct {
	Name      string `json:"name,omitempty"`
	Arguments string `json:"arguments,omitempty"`
}

type openAIChatResponse struct {
	Choices []struct {
		Message openAIChoiceMessage `json:"message"`
	} `json:"choices"`
	Usage openAIUsage `json:"usage,omitempty"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

type openAIUsage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

type openAIChoiceMessage struct {
	Content          string           `json:"content"`
	ReasoningContent string           `json:"reasoning_content"`
	Reasoning        string           `json:"reasoning"`
	Thinking         string           `json:"thinking"`
	ToolCalls        []openAIToolCall `json:"tool_calls,omitempty"`
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
		Tools:       openAIToolsFromGenerationRequest(req.Tools),
		ToolChoice:  openAIToolChoice(req.ToolChoice, req.Tools),
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
	toolCalls := generationToolCallsFromOpenAIMessage(firstOpenAIChoiceMessage(response))
	if err := validateGenerationToolCalls(toolCalls); err != nil {
		return GenerationResponse{Text: text, ReasoningText: reasoningText, Model: model, RawStatus: status, FinishedAt: NowString()}, err
	}
	return GenerationResponse{Text: text, ReasoningText: reasoningText, Model: model, RawStatus: status, FinishedAt: NowString(), ToolCalls: toolCalls, Usage: generationUsageFromOpenAI(response.Usage)}, nil
}

type openAIStreamChunk struct {
	Choices []struct {
		Delta        openAIChoiceMessage `json:"delta"`
		Message      openAIChoiceMessage `json:"message"`
		FinishReason string              `json:"finish_reason,omitempty"`
	} `json:"choices"`
	Usage openAIUsage `json:"usage,omitempty"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func openAIMessagesFromGenerationRequest(req GenerationRequest) []openAIMessage {
	messages := []openAIMessage{}
	system := generationSystemText(req)
	if len(req.Messages) > 0 {
		if system != "" {
			messages = append(messages, openAIMessage{Role: "system", Content: system})
		}
		for _, message := range req.Messages {
			role := normalizedOpenAIMessageRole(message.Role)
			if role == "system" {
				continue
			}
			content := strings.TrimSpace(message.Content)
			toolCallID := strings.TrimSpace(message.ToolCallID)
			name := strings.TrimSpace(message.Name)
			toolCalls := openAIToolCallsFromGenerationToolCalls(message.ToolCalls)
			if content == "" && toolCallID == "" && len(toolCalls) == 0 {
				continue
			}
			next := openAIMessage{Role: role, Content: content}
			if role == "assistant" && len(toolCalls) > 0 {
				next.ToolCalls = toolCalls
			}
			if role == "tool" {
				next.ToolCallID = toolCallID
				next.Name = name
			}
			messages = append(messages, next)
		}
		if len(messages) > 0 {
			return messages
		}
	}
	if system != "" {
		messages = append(messages, openAIMessage{Role: "system", Content: system})
	}
	if strings.TrimSpace(req.Prompt) != "" {
		messages = append(messages, openAIMessage{Role: "user", Content: req.Prompt})
	}
	return messages
}

func normalizedOpenAIMessageRole(role string) string {
	switch strings.ToLower(strings.TrimSpace(role)) {
	case "system", "assistant", "user", "tool":
		return strings.ToLower(strings.TrimSpace(role))
	default:
		return "user"
	}
}

func openAIToolsFromGenerationRequest(tools []GenerationTool) []openAITool {
	if len(tools) == 0 {
		return nil
	}
	output := make([]openAITool, 0, len(tools))
	for _, tool := range tools {
		name := strings.TrimSpace(tool.Name)
		if name == "" {
			continue
		}
		parameters := tool.Parameters
		if parameters == nil {
			parameters = map[string]any{"type": "object"}
		}
		output = append(output, openAITool{
			Type: "function",
			Function: openAIFunction{
				Name:        name,
				Description: strings.TrimSpace(tool.Description),
				Parameters:  parameters,
			},
		})
	}
	return output
}

func openAIToolCallsFromGenerationToolCalls(calls []GenerationToolCall) []openAIToolCall {
	if len(calls) == 0 {
		return nil
	}
	output := make([]openAIToolCall, 0, len(calls))
	for _, call := range calls {
		name := strings.TrimSpace(call.Name)
		if name == "" {
			continue
		}
		output = append(output, openAIToolCall{
			ID:   strings.TrimSpace(call.ID),
			Type: "function",
			Function: openAIToolCallFunction{
				Name:      name,
				Arguments: strings.TrimSpace(call.ArgumentsJSON),
			},
		})
	}
	return output
}

func openAIToolChoice(choice string, tools []GenerationTool) any {
	if len(tools) == 0 {
		return nil
	}
	choice = strings.TrimSpace(choice)
	if choice == "" {
		return "auto"
	}
	return choice
}

func firstOpenAIChoiceMessage(response openAIChatResponse) openAIChoiceMessage {
	if len(response.Choices) == 0 {
		return openAIChoiceMessage{}
	}
	return response.Choices[0].Message
}

func generationToolCallsFromOpenAIMessage(message openAIChoiceMessage) []GenerationToolCall {
	if len(message.ToolCalls) == 0 {
		return nil
	}
	output := make([]GenerationToolCall, 0, len(message.ToolCalls))
	for _, call := range message.ToolCalls {
		name := strings.TrimSpace(call.Function.Name)
		if name == "" {
			continue
		}
		output = append(output, GenerationToolCall{
			ID:            strings.TrimSpace(call.ID),
			Name:          name,
			ArgumentsJSON: strings.TrimSpace(call.Function.Arguments),
		})
	}
	return output
}

type openAIStreamToolCall struct {
	id        string
	typeName  string
	name      string
	arguments string
}

func accumulateOpenAIStreamToolCalls(accumulators map[int]*openAIStreamToolCall, calls []openAIToolCall, complete bool) error {
	for ordinal, call := range calls {
		index := ordinal
		if !complete {
			if call.Index == nil || *call.Index < 0 {
				return errors.New("openai-compatible tool-call delta is missing a valid index")
			}
			index = *call.Index
		} else if call.Index != nil {
			if *call.Index < 0 {
				return errors.New("openai-compatible tool call has a negative index")
			}
			index = *call.Index
		}
		accumulator := accumulators[index]
		if accumulator == nil {
			accumulator = &openAIStreamToolCall{}
			accumulators[index] = accumulator
		}
		if complete {
			if call.ID != "" {
				accumulator.id = call.ID
			}
			if call.Type != "" {
				accumulator.typeName = call.Type
			}
			if call.Function.Name != "" {
				accumulator.name = call.Function.Name
			}
			if call.Function.Arguments != "" {
				accumulator.arguments = call.Function.Arguments
			}
			continue
		}
		accumulator.id += call.ID
		accumulator.typeName += call.Type
		accumulator.name += call.Function.Name
		accumulator.arguments += call.Function.Arguments
	}
	return nil
}

func generationToolCallsFromOpenAIStream(accumulators map[int]*openAIStreamToolCall) ([]GenerationToolCall, error) {
	indices := make([]int, 0, len(accumulators))
	for index := range accumulators {
		indices = append(indices, index)
	}
	sort.Ints(indices)
	output := make([]GenerationToolCall, 0, len(indices))
	seenIDs := map[string]struct{}{}
	for expectedIndex, index := range indices {
		if index != expectedIndex {
			return nil, fmt.Errorf("openai-compatible tool-call indices are not contiguous at %d", expectedIndex)
		}
		accumulator := accumulators[index]
		if accumulator == nil || strings.TrimSpace(accumulator.name) == "" {
			return nil, fmt.Errorf("openai-compatible tool call %d is missing a function name", index)
		}
		if kind := strings.TrimSpace(accumulator.typeName); kind != "" && kind != "function" {
			return nil, fmt.Errorf("openai-compatible tool call %d has unsupported type %q", index, kind)
		}
		arguments := strings.TrimSpace(accumulator.arguments)
		if arguments == "" {
			arguments = "{}"
		}
		if err := validateToolArgumentsJSONObject(accumulator.name, arguments); err != nil {
			return nil, err
		}
		id := strings.TrimSpace(accumulator.id)
		if id != "" {
			if _, duplicate := seenIDs[id]; duplicate {
				return nil, fmt.Errorf("openai-compatible stream repeated tool-call id %q", id)
			}
			seenIDs[id] = struct{}{}
		}
		providerIndex := index
		output = append(output, GenerationToolCall{
			ID:            id,
			Name:          strings.TrimSpace(accumulator.name),
			ArgumentsJSON: arguments,
			ProviderIndex: &providerIndex,
		})
	}
	return output, nil
}

func generationUsageFromOpenAI(usage openAIUsage) GenerationTokenUsage {
	input := usage.PromptTokens
	output := usage.CompletionTokens
	total := usage.TotalTokens
	if total == 0 && (input > 0 || output > 0) {
		total = input + output
	}
	if input == 0 && output == 0 && total == 0 {
		return GenerationTokenUsage{}
	}
	return GenerationTokenUsage{
		InputTokens:  input,
		OutputTokens: output,
		TotalTokens:  total,
		Source:       "provider",
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
	var usage GenerationTokenUsage
	streamToolCalls := map[int]*openAIStreamToolCall{}
	completed := false
	finishReason := ""
	var finalizedToolCalls []GenerationToolCall
	result := func() GenerationResponse {
		return GenerationResponse{
			Text:          builder.String(),
			ReasoningText: reasoningBuilder.String(),
			Model:         request.Model,
			RawStatus:     status,
			FinishedAt:    NowString(),
			ToolCalls:     finalizedToolCalls,
			Usage:         usage,
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
		var chunk openAIStreamChunk
		if decodeErr := json.Unmarshal(data, &chunk); decodeErr != nil {
			return decodeErr
		}
		if chunk.Error != nil && strings.TrimSpace(chunk.Error.Message) != "" {
			return errors.New(chunk.Error.Message)
		}
		if parsedUsage := generationUsageFromOpenAI(chunk.Usage); parsedUsage.TotalTokens > 0 {
			usage = parsedUsage
		}
		if len(chunk.Choices) == 0 {
			return nil
		}
		choice := chunk.Choices[0]
		if reason := strings.TrimSpace(choice.FinishReason); reason != "" {
			if finishReason != "" && finishReason != reason {
				return fmt.Errorf("openai-compatible stream changed finish_reason from %q to %q", finishReason, reason)
			}
			finishReason = reason
			completed = true
		}
		if err := accumulateOpenAIStreamToolCalls(streamToolCalls, choice.Delta.ToolCalls, false); err != nil {
			return err
		}
		if err := accumulateOpenAIStreamToolCalls(streamToolCalls, choice.Message.ToolCalls, true); err != nil {
			return err
		}
		token := choice.Delta.Content
		if token == "" {
			token = choice.Message.Content
		}
		reasoningToken := openAIReasoningText(choice.Delta)
		if reasoningToken == "" {
			reasoningToken = openAIReasoningText(choice.Message)
		}
		if reasoningToken != "" {
			reasoningBuilder.WriteString(reasoningToken)
		}
		if token == "" {
			return nil
		}
		builder.WriteString(token)
		return sink(token)
	})
	if err != nil {
		return result(), err
	}
	if !completed {
		return result(), errors.New("openai-compatible stream ended before a terminal marker")
	}
	toolCalls, toolErr := generationToolCallsFromOpenAIStream(streamToolCalls)
	if toolErr != nil {
		return result(), toolErr
	}
	switch finishReason {
	case "length", "content_filter", "function_call":
		return result(), fmt.Errorf("openai-compatible stream ended incompletely with finish_reason %q", finishReason)
	case "tool_calls":
		if len(toolCalls) == 0 {
			return result(), errors.New("openai-compatible stream declared tool_calls without a complete call")
		}
	case "", "stop":
		if len(toolCalls) > 0 {
			return result(), fmt.Errorf("openai-compatible tool stream ended with finish_reason %q", finishReason)
		}
	default:
		return result(), fmt.Errorf("openai-compatible stream ended with unsupported finish_reason %q", finishReason)
	}
	finalizedToolCalls = toolCalls
	return result(), nil
}
