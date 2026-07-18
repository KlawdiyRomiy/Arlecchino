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

const DefaultAnthropicEndpoint = "https://api.anthropic.com/v1"

type AnthropicProvider struct {
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

type AnthropicOptions struct {
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

func NewAnthropicProvider(opts AnthropicOptions) *AnthropicProvider {
	if strings.TrimSpace(opts.ID) == "" {
		opts.ID = "anthropic-frontier"
	}
	if strings.TrimSpace(opts.Name) == "" {
		opts.Name = "Anthropic"
	}
	if strings.TrimSpace(opts.Kind) == "" {
		opts.Kind = "anthropic"
	}
	return &AnthropicProvider{
		id:            strings.TrimSpace(opts.ID),
		name:          strings.TrimSpace(opts.Name),
		kind:          strings.TrimSpace(opts.Kind),
		endpoint:      normalizeEndpoint(opts.Endpoint, DefaultAnthropicEndpoint),
		model:         strings.TrimSpace(opts.Model),
		manual:        opts.Manual,
		frontier:      opts.Frontier || strings.TrimSpace(opts.EndpointClass) == "",
		endpointClass: strings.TrimSpace(opts.EndpointClass),
		secret:        strings.TrimSpace(opts.Secret),
		client:        newHTTPClient(opts.Timeout),
	}
}

func (p *AnthropicProvider) Descriptor() AIProviderDescriptor {
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
		AdapterVersion:     "arlecchino-anthropic-runtime-v1",
		ProtocolVersion:    "anthropic_messages_2023_06_01",
		CompatibilityRange: "anthropic_messages_api",
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

type anthropicModelsResponse struct {
	Data []struct {
		ID          string `json:"id"`
		DisplayName string `json:"display_name"`
	} `json:"data"`
}

func (p *AnthropicProvider) headers() map[string]string {
	headers := map[string]string{"anthropic-version": "2023-06-01"}
	if p.secret != "" {
		headers["x-api-key"] = p.secret
	}
	return headers
}

func (p *AnthropicProvider) ListModels(ctx context.Context) ([]AIModelDescriptor, error) {
	if p.secret == "" {
		return nil, fmt.Errorf("provider requires an API key")
	}
	var response anthropicModelsResponse
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
			ID:               id,
			DisplayName:      firstNonEmptyString(model.DisplayName, id),
			Streaming:        true,
			ToolCalling:      true,
			StructuredOutput: true,
			PatchGeneration:  true,
		}))
	}
	return models, nil
}

func (p *AnthropicProvider) HealthCheck(ctx context.Context) AIProviderDescriptor {
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

type anthropicMessageRequest struct {
	Model       string             `json:"model"`
	MaxTokens   int                `json:"max_tokens"`
	System      string             `json:"system,omitempty"`
	Messages    []anthropicMessage `json:"messages"`
	Temperature float64            `json:"temperature,omitempty"`
	Tools       []anthropicTool    `json:"tools,omitempty"`
	ToolChoice  any                `json:"tool_choice,omitempty"`
	Stream      bool               `json:"stream,omitempty"`
}

type anthropicMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

type anthropicContentBlock struct {
	Type      string `json:"type"`
	Text      string `json:"text,omitempty"`
	ID        string `json:"id,omitempty"`
	Name      string `json:"name,omitempty"`
	Input     any    `json:"input,omitempty"`
	ToolUseID string `json:"tool_use_id,omitempty"`
	Content   string `json:"content,omitempty"`
}

type anthropicTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	InputSchema map[string]any `json:"input_schema,omitempty"`
}

type anthropicMessageResponse struct {
	Content []anthropicContentBlock `json:"content"`
	Model   string                  `json:"model,omitempty"`
	Usage   struct {
		InputTokens  int `json:"input_tokens"`
		OutputTokens int `json:"output_tokens"`
	} `json:"usage,omitempty"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

type anthropicStreamEvent struct {
	Type    string `json:"type"`
	Index   int    `json:"index,omitempty"`
	Message struct {
		Model string `json:"model,omitempty"`
		Usage struct {
			InputTokens  int `json:"input_tokens"`
			OutputTokens int `json:"output_tokens"`
		} `json:"usage,omitempty"`
	} `json:"message,omitempty"`
	ContentBlock anthropicContentBlock `json:"content_block,omitempty"`
	Delta        struct {
		Type        string `json:"type,omitempty"`
		Text        string `json:"text,omitempty"`
		PartialJSON string `json:"partial_json,omitempty"`
		StopReason  string `json:"stop_reason,omitempty"`
	} `json:"delta,omitempty"`
	Usage struct {
		OutputTokens int `json:"output_tokens"`
	} `json:"usage,omitempty"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

type anthropicStreamBlock struct {
	content     anthropicContentBlock
	partialJSON strings.Builder
	completed   bool
}

func (p *AnthropicProvider) Generate(ctx context.Context, req GenerationRequest, sink TokenSink) (GenerationResponse, error) {
	if p.secret == "" {
		return GenerationResponse{}, fmt.Errorf("provider requires an API key")
	}
	model := firstNonEmptyString(req.Model, p.model)
	if model == "" {
		return GenerationResponse{}, fmt.Errorf("provider model is not configured")
	}
	maxTokens := req.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 512
	}
	request := anthropicMessageRequest{
		Model:       model,
		MaxTokens:   maxTokens,
		System:      generationSystemText(req),
		Messages:    anthropicMessagesFromGenerationRequest(req),
		Temperature: req.Temperature,
		Tools:       anthropicToolsFromGenerationRequest(req.Tools),
		ToolChoice:  anthropicToolChoice(req.ToolChoice, req.Tools),
		Stream:      req.Stream && sink != nil,
	}
	if request.Stream {
		return p.generateStreaming(ctx, request, sink)
	}
	var response anthropicMessageResponse
	status, err := postJSON(ctx, p.client, p.endpoint+"/messages", p.headers(), request, &response)
	if err != nil {
		return GenerationResponse{RawStatus: status}, err
	}
	if response.Error != nil && strings.TrimSpace(response.Error.Message) != "" {
		return GenerationResponse{RawStatus: status}, errors.New(response.Error.Message)
	}
	text, toolCalls := anthropicResponseContent(response.Content)
	if err := validateGenerationToolCalls(toolCalls); err != nil {
		return GenerationResponse{Text: text, Model: firstNonEmptyString(response.Model, model), RawStatus: status, FinishedAt: NowString()}, err
	}
	if sink != nil && text != "" {
		if err := sink(text); err != nil {
			return GenerationResponse{Text: text, Model: model, RawStatus: status, FinishedAt: NowString()}, err
		}
	}
	return GenerationResponse{
		Text:       text,
		Model:      firstNonEmptyString(response.Model, model),
		RawStatus:  status,
		FinishedAt: NowString(),
		ToolCalls:  toolCalls,
		Usage: GenerationTokenUsage{
			InputTokens:  response.Usage.InputTokens,
			OutputTokens: response.Usage.OutputTokens,
			TotalTokens:  response.Usage.InputTokens + response.Usage.OutputTokens,
			Source:       "provider",
		},
	}, nil
}

func (p *AnthropicProvider) generateStreaming(ctx context.Context, request anthropicMessageRequest, sink TokenSink) (GenerationResponse, error) {
	resp, err := postJSONRaw(ctx, p.client, p.endpoint+"/messages", p.headers(), request)
	if err != nil {
		return GenerationResponse{}, err
	}
	defer resp.Body.Close()
	status := resp.StatusCode
	if status < 200 || status >= 300 {
		limited, _ := io.ReadAll(io.LimitReader(resp.Body, 16<<10))
		return GenerationResponse{RawStatus: status}, fmt.Errorf("provider returned HTTP %d: %s", status, strings.TrimSpace(string(limited)))
	}

	model := request.Model
	var text strings.Builder
	usage := GenerationTokenUsage{Source: "provider"}
	blocks := map[int]*anthropicStreamBlock{}
	completed := false
	stopReason := ""
	result := func() GenerationResponse {
		usage.TotalTokens = usage.InputTokens + usage.OutputTokens
		return GenerationResponse{
			Text:       text.String(),
			Model:      model,
			RawStatus:  status,
			FinishedAt: NowString(),
			ToolCalls:  anthropicToolCallsFromStreamBlocks(blocks),
			Usage:      usage,
		}
	}
	err = scanServerSentEvents(resp.Body, func(_ string, data []byte) error {
		if len(data) == 0 {
			return nil
		}
		var event anthropicStreamEvent
		if decodeErr := json.Unmarshal(data, &event); decodeErr != nil {
			return decodeErr
		}
		if event.Error != nil && strings.TrimSpace(event.Error.Message) != "" {
			return errors.New(event.Error.Message)
		}
		switch event.Type {
		case "message_start":
			model = firstNonEmptyString(event.Message.Model, model)
			usage.InputTokens = event.Message.Usage.InputTokens
			if event.Message.Usage.OutputTokens > usage.OutputTokens {
				usage.OutputTokens = event.Message.Usage.OutputTokens
			}
		case "content_block_start":
			block := &anthropicStreamBlock{content: event.ContentBlock}
			blocks[event.Index] = block
			if event.ContentBlock.Type == "text" && event.ContentBlock.Text != "" {
				text.WriteString(event.ContentBlock.Text)
				if sinkErr := sink(event.ContentBlock.Text); sinkErr != nil {
					return sinkErr
				}
			}
		case "content_block_delta":
			block := blocks[event.Index]
			if block == nil {
				block = &anthropicStreamBlock{}
				blocks[event.Index] = block
			}
			switch event.Delta.Type {
			case "text_delta":
				if event.Delta.Text != "" {
					text.WriteString(event.Delta.Text)
					if sinkErr := sink(event.Delta.Text); sinkErr != nil {
						return sinkErr
					}
				}
			case "input_json_delta":
				block.partialJSON.WriteString(event.Delta.PartialJSON)
			}
		case "content_block_stop":
			block := blocks[event.Index]
			if block == nil {
				return fmt.Errorf("anthropic stream stopped unknown content block %d", event.Index)
			}
			block.completed = true
		case "message_delta":
			stopReason = strings.TrimSpace(event.Delta.StopReason)
			if event.Usage.OutputTokens > usage.OutputTokens {
				usage.OutputTokens = event.Usage.OutputTokens
			}
		case "message_stop":
			completed = true
		}
		return nil
	})
	if err != nil {
		return result(), err
	}
	if !completed {
		return result(), errors.New("anthropic stream ended before message_stop")
	}
	toolCalls := anthropicToolCallsFromStreamBlocks(blocks)
	if len(toolCalls) > 0 && stopReason != "tool_use" {
		return result(), fmt.Errorf("anthropic tool stream ended with stop_reason %q", stopReason)
	}
	for index, block := range blocks {
		if block != nil && block.content.Type == "tool_use" && !block.completed {
			return result(), fmt.Errorf("anthropic tool stream ended before content_block_stop for index %d", index)
		}
	}
	if err := validateGenerationToolCalls(toolCalls); err != nil {
		return result(), err
	}
	return result(), nil
}

func anthropicToolCallsFromStreamBlocks(blocks map[int]*anthropicStreamBlock) []GenerationToolCall {
	indices := make([]int, 0, len(blocks))
	for index := range blocks {
		indices = append(indices, index)
	}
	sort.Ints(indices)
	toolCalls := []GenerationToolCall{}
	for _, index := range indices {
		block := blocks[index]
		if block == nil || block.content.Type != "tool_use" || strings.TrimSpace(block.content.Name) == "" {
			continue
		}
		arguments := strings.TrimSpace(block.partialJSON.String())
		if arguments == "" && block.content.Input != nil {
			if encoded, err := json.Marshal(block.content.Input); err == nil {
				arguments = string(encoded)
			}
		}
		if arguments == "" {
			arguments = "{}"
		}
		toolCalls = append(toolCalls, GenerationToolCall{
			ID:            strings.TrimSpace(block.content.ID),
			Name:          strings.TrimSpace(block.content.Name),
			ArgumentsJSON: arguments,
		})
	}
	return toolCalls
}

func anthropicMessagesFromGenerationRequest(req GenerationRequest) []anthropicMessage {
	if len(req.Messages) == 0 {
		if strings.TrimSpace(req.Prompt) == "" {
			return []anthropicMessage{}
		}
		return []anthropicMessage{{Role: "user", Content: req.Prompt}}
	}
	messages := make([]anthropicMessage, 0, len(req.Messages))
	for _, message := range req.Messages {
		role := strings.ToLower(strings.TrimSpace(message.Role))
		switch role {
		case "assistant":
		default:
			role = "user"
		}
		if len(message.ToolCalls) > 0 {
			blocks := anthropicToolUseBlocks(message.ToolCalls)
			if content := strings.TrimSpace(message.Content); content != "" {
				blocks = append([]anthropicContentBlock{{Type: "text", Text: content}}, blocks...)
			}
			messages = append(messages, anthropicMessage{Role: "assistant", Content: blocks})
			continue
		}
		if strings.TrimSpace(message.ToolCallID) != "" {
			resultBlock := anthropicContentBlock{
				Type:      "tool_result",
				ToolUseID: strings.TrimSpace(message.ToolCallID),
				Content:   strings.TrimSpace(message.Content),
			}
			if len(messages) > 0 && messages[len(messages)-1].Role == "user" {
				if blocks, ok := anthropicToolResultBlocks(messages[len(messages)-1].Content); ok {
					messages[len(messages)-1].Content = append(blocks, resultBlock)
					continue
				}
			}
			messages = append(messages, anthropicMessage{Role: "user", Content: []anthropicContentBlock{resultBlock}})
			continue
		}
		if strings.TrimSpace(message.Content) == "" || strings.ToLower(strings.TrimSpace(message.Role)) == "system" {
			continue
		}
		messages = append(messages, anthropicMessage{Role: role, Content: message.Content})
	}
	return messages
}

func anthropicToolResultBlocks(content any) ([]anthropicContentBlock, bool) {
	blocks, ok := content.([]anthropicContentBlock)
	if !ok || len(blocks) == 0 {
		return nil, false
	}
	for _, block := range blocks {
		if block.Type != "tool_result" {
			return nil, false
		}
	}
	return blocks, true
}

func anthropicToolUseBlocks(calls []GenerationToolCall) []anthropicContentBlock {
	blocks := make([]anthropicContentBlock, 0, len(calls))
	for _, call := range calls {
		name := strings.TrimSpace(call.Name)
		if name == "" {
			continue
		}
		var input any = map[string]any{}
		if raw := strings.TrimSpace(call.ArgumentsJSON); raw != "" {
			var decoded any
			if err := json.Unmarshal([]byte(raw), &decoded); err == nil {
				input = decoded
			}
		}
		blocks = append(blocks, anthropicContentBlock{Type: "tool_use", ID: strings.TrimSpace(call.ID), Name: name, Input: input})
	}
	return blocks
}

func anthropicToolsFromGenerationRequest(tools []GenerationTool) []anthropicTool {
	if len(tools) == 0 {
		return nil
	}
	output := make([]anthropicTool, 0, len(tools))
	for _, tool := range tools {
		name := strings.TrimSpace(tool.Name)
		if name == "" {
			continue
		}
		schema := tool.Parameters
		if schema == nil {
			schema = map[string]any{"type": "object"}
		}
		output = append(output, anthropicTool{Name: name, Description: strings.TrimSpace(tool.Description), InputSchema: schema})
	}
	return output
}

func anthropicToolChoice(choice string, tools []GenerationTool) any {
	if len(tools) == 0 {
		return nil
	}
	if strings.TrimSpace(choice) == "required" && len(tools) == 1 {
		return map[string]any{"type": "tool", "name": strings.TrimSpace(tools[0].Name)}
	}
	return map[string]any{"type": "auto"}
}

func anthropicResponseContent(blocks []anthropicContentBlock) (string, []GenerationToolCall) {
	var text strings.Builder
	toolCalls := []GenerationToolCall{}
	for _, block := range blocks {
		switch block.Type {
		case "text":
			text.WriteString(block.Text)
		case "tool_use":
			arguments := "{}"
			if block.Input != nil {
				if encoded, err := json.Marshal(block.Input); err == nil {
					arguments = string(encoded)
				}
			}
			toolCalls = append(toolCalls, GenerationToolCall{ID: strings.TrimSpace(block.ID), Name: strings.TrimSpace(block.Name), ArgumentsJSON: arguments})
		}
	}
	return text.String(), toolCalls
}
