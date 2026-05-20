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
		Capabilities: append(DefaultCapabilities(), CapabilityStructuredOutput, CapabilityPatchGeneration),
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
	Response        string `json:"response"`
	Done            bool   `json:"done"`
	Model           string `json:"model"`
	PromptEvalCount int    `json:"prompt_eval_count"`
	EvalCount       int    `json:"eval_count"`
}

type ollamaChatRequest struct {
	Model    string              `json:"model"`
	Messages []ollamaChatMessage `json:"messages"`
	Stream   bool                `json:"stream"`
	Tools    []openAITool        `json:"tools,omitempty"`
	Options  map[string]any      `json:"options,omitempty"`
}

type ollamaChatMessage struct {
	Role      string           `json:"role"`
	Content   string           `json:"content,omitempty"`
	Thinking  string           `json:"thinking,omitempty"`
	ToolName  string           `json:"tool_name,omitempty"`
	ToolCalls []ollamaToolCall `json:"tool_calls,omitempty"`
}

type ollamaToolCall struct {
	ID       string                 `json:"id,omitempty"`
	Type     string                 `json:"type,omitempty"`
	Function ollamaToolCallFunction `json:"function"`
}

type ollamaToolCallFunction struct {
	Index     int             `json:"index,omitempty"`
	Name      string          `json:"name,omitempty"`
	Arguments json.RawMessage `json:"arguments,omitempty"`
}

type ollamaChatResponse struct {
	Model           string            `json:"model"`
	Message         ollamaChatMessage `json:"message"`
	Done            bool              `json:"done"`
	Error           string            `json:"error,omitempty"`
	PromptEvalCount int               `json:"prompt_eval_count"`
	EvalCount       int               `json:"eval_count"`
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
	options := map[string]any{
		"num_predict": maxTokens,
		"temperature": temperature,
	}
	if len(req.Stop) > 0 {
		options["stop"] = req.Stop
	}
	if len(req.Tools) > 0 || ollamaMessagesNeedChat(req.Messages) {
		tools := openAIToolsFromGenerationRequest(req.Tools)
		request := ollamaChatRequest{
			Model:    model,
			Messages: ollamaMessagesFromGenerationRequest(req),
			Stream:   false,
			Tools:    tools,
			Options:  options,
		}
		return p.generateChat(ctx, request, sink)
	}
	prompt := req.Prompt
	system := req.System
	if len(req.Messages) > 0 {
		system, prompt = flattenGenerationMessagesForPrompt(req)
	}
	request := ollamaGenerateRequest{
		Model:   model,
		Prompt:  prompt,
		System:  system,
		Stream:  req.Stream && sink != nil,
		Options: options,
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
	return GenerationResponse{Text: text, Model: model, RawStatus: status, FinishedAt: NowString(), Usage: generationUsageFromOllama(response.PromptEvalCount, response.EvalCount)}, nil
}

func (p *OllamaProvider) generateChat(ctx context.Context, request ollamaChatRequest, sink TokenSink) (GenerationResponse, error) {
	var response ollamaChatResponse
	status, err := postJSON(ctx, p.client, p.endpoint+"/api/chat", nil, request, &response)
	if err != nil {
		return GenerationResponse{RawStatus: status}, err
	}
	if strings.TrimSpace(response.Error) != "" {
		return GenerationResponse{RawStatus: status}, errors.New(response.Error)
	}
	model := request.Model
	if strings.TrimSpace(response.Model) != "" {
		model = response.Model
	}
	text := response.Message.Content
	reasoningText := response.Message.Thinking
	toolCalls := generationToolCallsFromOllamaMessage(response.Message)
	if len(toolCalls) == 0 && len(request.Tools) > 0 {
		if parsed := ollamaToolCallsFromContent(text, request.Tools); len(parsed) > 0 {
			toolCalls = parsed
			text = ""
		}
	}
	return GenerationResponse{Text: text, ReasoningText: reasoningText, Model: model, RawStatus: status, FinishedAt: NowString(), ToolCalls: toolCalls, Usage: generationUsageFromOllama(response.PromptEvalCount, response.EvalCount)}, nil
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
	var usage GenerationTokenUsage
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
		if parsedUsage := generationUsageFromOllama(chunk.PromptEvalCount, chunk.EvalCount); parsedUsage.TotalTokens > 0 {
			usage = parsedUsage
		}
		if chunk.Response != "" {
			builder.WriteString(chunk.Response)
			if err := sink(chunk.Response); err != nil {
				return GenerationResponse{Text: builder.String(), Model: model, RawStatus: status, FinishedAt: NowString(), Usage: usage}, err
			}
		}
		if chunk.Done {
			break
		}
	}
	if err := scanner.Err(); err != nil {
		return GenerationResponse{Text: builder.String(), Model: model, RawStatus: status, FinishedAt: NowString(), Usage: usage}, err
	}
	return GenerationResponse{Text: builder.String(), Model: model, RawStatus: status, FinishedAt: NowString(), Usage: usage}, nil
}

func generationUsageFromOllama(promptEvalCount int, evalCount int) GenerationTokenUsage {
	total := promptEvalCount + evalCount
	if total == 0 {
		return GenerationTokenUsage{}
	}
	return GenerationTokenUsage{
		InputTokens:  promptEvalCount,
		OutputTokens: evalCount,
		TotalTokens:  total,
		Source:       "provider",
	}
}

func ollamaMessagesNeedChat(messages []GenerationMessage) bool {
	for _, message := range messages {
		if normalizedOpenAIMessageRole(message.Role) == "tool" || len(message.ToolCalls) > 0 {
			return true
		}
	}
	return false
}

func ollamaMessagesFromGenerationRequest(req GenerationRequest) []ollamaChatMessage {
	messages := []ollamaChatMessage{}
	if len(req.Messages) > 0 {
		if strings.TrimSpace(req.System) != "" && !generationMessagesContainSystem(req.Messages) {
			messages = append(messages, ollamaChatMessage{Role: "system", Content: req.System})
		}
		for _, message := range req.Messages {
			role := normalizedOpenAIMessageRole(message.Role)
			content := strings.TrimSpace(message.Content)
			toolCalls := ollamaToolCallsFromGenerationToolCalls(message.ToolCalls)
			toolName := strings.TrimSpace(message.Name)
			if content == "" && toolName == "" && len(toolCalls) == 0 {
				continue
			}
			next := ollamaChatMessage{Role: role, Content: content}
			if role == "assistant" && len(toolCalls) > 0 {
				next.ToolCalls = toolCalls
			}
			if role == "tool" {
				next.ToolName = toolName
			}
			messages = append(messages, next)
		}
		if len(messages) > 0 {
			return messages
		}
	}
	if strings.TrimSpace(req.System) != "" {
		messages = append(messages, ollamaChatMessage{Role: "system", Content: req.System})
	}
	if strings.TrimSpace(req.Prompt) != "" {
		messages = append(messages, ollamaChatMessage{Role: "user", Content: req.Prompt})
	}
	return messages
}

func ollamaToolCallsFromGenerationToolCalls(calls []GenerationToolCall) []ollamaToolCall {
	if len(calls) == 0 {
		return nil
	}
	output := make([]ollamaToolCall, 0, len(calls))
	for index, call := range calls {
		name := strings.TrimSpace(call.Name)
		if name == "" {
			continue
		}
		output = append(output, ollamaToolCall{
			ID:   strings.TrimSpace(call.ID),
			Type: "function",
			Function: ollamaToolCallFunction{
				Index:     index,
				Name:      name,
				Arguments: ollamaToolArgumentsRaw(call.ArgumentsJSON),
			},
		})
	}
	return output
}

func generationToolCallsFromOllamaMessage(message ollamaChatMessage) []GenerationToolCall {
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
			ArgumentsJSON: ollamaToolArgumentsJSON(call.Function.Arguments),
		})
	}
	return output
}

type ollamaContentToolCall struct {
	Name      string                  `json:"name"`
	Tool      string                  `json:"tool"`
	Arguments json.RawMessage         `json:"arguments"`
	Function  ollamaToolCallFunction  `json:"function"`
	ToolCalls []ollamaContentToolCall `json:"tool_calls"`
}

func ollamaToolCallsFromContent(content string, tools []openAITool) []GenerationToolCall {
	content = ollamaTrimJSONFence(content)
	if content == "" || !json.Valid([]byte(content)) {
		return nil
	}
	allowed := ollamaAllowedToolNames(tools)
	var batch []ollamaContentToolCall
	if err := json.Unmarshal([]byte(content), &batch); err == nil {
		return generationToolCallsFromOllamaContentCalls(batch, allowed)
	}
	var single ollamaContentToolCall
	if err := json.Unmarshal([]byte(content), &single); err != nil {
		return nil
	}
	if len(single.ToolCalls) > 0 {
		return generationToolCallsFromOllamaContentCalls(single.ToolCalls, allowed)
	}
	return generationToolCallsFromOllamaContentCalls([]ollamaContentToolCall{single}, allowed)
}

func generationToolCallsFromOllamaContentCalls(calls []ollamaContentToolCall, allowed map[string]struct{}) []GenerationToolCall {
	output := make([]GenerationToolCall, 0, len(calls))
	for _, call := range calls {
		name := strings.TrimSpace(firstNonEmptyString(call.Function.Name, call.Name, call.Tool))
		if name == "" {
			continue
		}
		if len(allowed) > 0 {
			if _, ok := allowed[name]; !ok {
				continue
			}
		}
		arguments := call.Arguments
		if len(arguments) == 0 {
			arguments = call.Function.Arguments
		}
		output = append(output, GenerationToolCall{
			Name:          name,
			ArgumentsJSON: ollamaToolArgumentsJSON(arguments),
		})
	}
	return output
}

func ollamaAllowedToolNames(tools []openAITool) map[string]struct{} {
	if len(tools) == 0 {
		return nil
	}
	allowed := make(map[string]struct{}, len(tools))
	for _, tool := range tools {
		name := strings.TrimSpace(tool.Function.Name)
		if name != "" {
			allowed[name] = struct{}{}
		}
	}
	return allowed
}

func ollamaTrimJSONFence(content string) string {
	content = strings.TrimSpace(content)
	if !strings.HasPrefix(content, "```") {
		return content
	}
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSpace(content)
	if newline := strings.Index(content, "\n"); newline >= 0 {
		firstLine := strings.TrimSpace(content[:newline])
		if firstLine == "json" || firstLine == "JSON" {
			content = content[newline+1:]
		}
	}
	content = strings.TrimSpace(content)
	content = strings.TrimSuffix(content, "```")
	return strings.TrimSpace(content)
}

func ollamaToolArgumentsRaw(value string) json.RawMessage {
	value = strings.TrimSpace(value)
	if value == "" {
		return json.RawMessage(`{}`)
	}
	if json.Valid([]byte(value)) {
		return json.RawMessage(value)
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return json.RawMessage(`{}`)
	}
	return json.RawMessage(encoded)
}

func ollamaToolArgumentsJSON(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var asString string
	if err := json.Unmarshal(raw, &asString); err == nil {
		return strings.TrimSpace(asString)
	}
	return strings.TrimSpace(string(raw))
}

func flattenGenerationMessagesForPrompt(req GenerationRequest) (string, string) {
	systemParts := []string{}
	if strings.TrimSpace(req.System) != "" {
		systemParts = append(systemParts, strings.TrimSpace(req.System))
	}
	promptParts := []string{}
	for _, message := range req.Messages {
		content := strings.TrimSpace(message.Content)
		if content == "" {
			continue
		}
		switch strings.ToLower(strings.TrimSpace(message.Role)) {
		case "system":
			systemParts = append(systemParts, content)
		case "assistant":
			promptParts = append(promptParts, "Assistant:\n"+content)
		case "tool":
			promptParts = append(promptParts, "Tool result:\n"+content)
		default:
			promptParts = append(promptParts, "User:\n"+content)
		}
	}
	if len(promptParts) == 0 && strings.TrimSpace(req.Prompt) != "" {
		promptParts = append(promptParts, strings.TrimSpace(req.Prompt))
	}
	return strings.Join(systemParts, "\n\n"), strings.Join(promptParts, "\n\n")
}
