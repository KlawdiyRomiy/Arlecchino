package mcp

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"
	"sync"
)

const mcpProtocolVersion = "2024-11-05"

const (
	maxHeaderSize = 8 * 1024
	maxBodySize   = 10 * 1024 * 1024
)

type messageEncoding uint8

const (
	messageEncodingFramed messageEncoding = iota
	messageEncodingLineDelimited
)

type Server struct {
	service *ToolService
	reader  *bufio.Reader
	writer  io.Writer
	errOut  io.Writer

	writeMu sync.Mutex
}

type rpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id,omitempty"`
	Result  any             `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type toolsCallParams struct {
	Name      string         `json:"name"`
	Arguments map[string]any `json:"arguments"`
}

type initializeParams struct {
	ProtocolVersion string                 `json:"protocolVersion"`
	Capabilities    map[string]interface{} `json:"capabilities"`
	ClientInfo      map[string]interface{} `json:"clientInfo"`
}

func NewServer(service *ToolService, in io.Reader, out io.Writer, errOut io.Writer) *Server {
	return &Server{
		service: service,
		reader:  bufio.NewReader(in),
		writer:  out,
		errOut:  errOut,
	}
}

func (s *Server) Serve(ctx context.Context) error {
	for {
		select {
		case <-ctx.Done():
			return nil
		default:
		}

		body, encoding, err := readIncomingMessage(s.reader)
		if err != nil {
			if err == io.EOF {
				return nil
			}
			return err
		}

		var request rpcRequest
		if err := json.Unmarshal(body, &request); err != nil {
			if writeErr := s.writeError(nil, -32700, "parse error", encoding); writeErr != nil {
				return writeErr
			}
			continue
		}

		if request.Method == "" {
			if len(request.ID) == 0 {
				continue
			}
			if err := s.writeError(request.ID, -32600, "invalid request", encoding); err != nil {
				return err
			}
			continue
		}

		result, responseErr := s.handleRequest(request.Method, request.Params)
		if len(request.ID) == 0 {
			continue
		}

		if responseErr != nil {
			if err := s.writeError(request.ID, responseErr.Code, responseErr.Message, encoding); err != nil {
				return err
			}
			continue
		}

		if err := s.writeResult(request.ID, result, encoding); err != nil {
			return err
		}
	}
}

func (s *Server) handleRequest(method string, params json.RawMessage) (any, *rpcError) {
	switch method {
	case "initialize":
		var initParams initializeParams
		if len(params) > 0 {
			if err := json.Unmarshal(params, &initParams); err != nil {
				return nil, &rpcError{Code: -32602, Message: "invalid initialize params"}
			}
		}

		negotiatedProtocolVersion := strings.TrimSpace(initParams.ProtocolVersion)
		if negotiatedProtocolVersion == "" {
			negotiatedProtocolVersion = mcpProtocolVersion
		}

		return map[string]any{
			"protocolVersion": negotiatedProtocolVersion,
			"capabilities": map[string]any{
				"tools": map[string]any{},
			},
			"serverInfo": map[string]any{
				"name":    "arlecchino-mcp",
				"version": "0.1.0",
			},
			"instructions": s.service.InitializeInstructions(),
		}, nil
	case "initialized", "notifications/initialized":
		return map[string]any{}, nil
	case "tools/list":
		return map[string]any{
			"tools": s.service.ToolDefinitions(),
		}, nil
	case "tools/call":
		var callParams toolsCallParams
		if len(params) > 0 {
			if err := json.Unmarshal(params, &callParams); err != nil {
				return nil, &rpcError{Code: -32602, Message: "invalid tools/call params"}
			}
		}

		if strings.TrimSpace(callParams.Name) == "" {
			return nil, &rpcError{Code: -32602, Message: "tool name is required"}
		}

		result, err := s.service.CallTool(callParams.Name, callParams.Arguments)
		if err != nil {
			return map[string]any{
				"content": []map[string]string{{
					"type": "text",
					"text": err.Error(),
				}},
				"isError": true,
			}, nil
		}

		return map[string]any{
			"content": []map[string]string{{
				"type": "text",
				"text": formatToolResult(result),
			}},
			"isError": false,
		}, nil
	case "ping":
		return map[string]any{}, nil
	default:
		return nil, &rpcError{Code: -32601, Message: "method not found"}
	}
}

func (s *Server) writeResult(id json.RawMessage, result any, encoding messageEncoding) error {
	response := rpcResponse{
		JSONRPC: "2.0",
		ID:      id,
		Result:  result,
	}
	return s.writeResponse(response, encoding)
}

func (s *Server) writeError(id json.RawMessage, code int, message string, encoding messageEncoding) error {
	response := rpcResponse{
		JSONRPC: "2.0",
		ID:      id,
		Error: &rpcError{
			Code:    code,
			Message: message,
		},
	}
	return s.writeResponse(response, encoding)
}

func (s *Server) writeResponse(response rpcResponse, encoding messageEncoding) error {
	body, err := json.Marshal(response)
	if err != nil {
		return err
	}

	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	if encoding == messageEncodingLineDelimited {
		line := append(body, '\n')
		if _, err := s.writer.Write(line); err != nil {
			return err
		}
	} else {
		header := fmt.Sprintf("Content-Length: %d\r\n\r\n", len(body))
		if _, err := io.WriteString(s.writer, header); err != nil {
			return err
		}
		if _, err := s.writer.Write(body); err != nil {
			return err
		}
	}

	if flusher, ok := s.writer.(interface{ Flush() error }); ok {
		if err := flusher.Flush(); err != nil {
			return err
		}
	}

	return nil
}

func readIncomingMessage(reader *bufio.Reader) ([]byte, messageEncoding, error) {
	firstLine, err := reader.ReadString('\n')
	if err != nil {
		return nil, messageEncodingFramed, err
	}

	trimmedFirstLine := strings.TrimRight(firstLine, "\r\n")
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(trimmedFirstLine)), "content-length:") {
		body, framedErr := readContentLengthFramedMessage(reader, firstLine)
		return body, messageEncodingFramed, framedErr
	}

	payload := strings.TrimSpace(trimmedFirstLine)
	if payload == "" {
		return nil, messageEncodingLineDelimited, fmt.Errorf("empty message")
	}
	if len(payload) > maxBodySize {
		return nil, messageEncodingLineDelimited, fmt.Errorf("message size %d exceeds maximum %d", len(payload), maxBodySize)
	}

	return []byte(payload), messageEncodingLineDelimited, nil
}

func readFramedMessage(reader *bufio.Reader) ([]byte, error) {
	body, _, err := readIncomingMessage(reader)
	return body, err
}

func readContentLengthFramedMessage(reader *bufio.Reader, firstLine string) ([]byte, error) {
	contentLength := -1
	headersSize := 0
	parseHeaderLine := func(line string) (bool, error) {
		headersSize += len(line)
		if headersSize > maxHeaderSize {
			return false, fmt.Errorf("header size exceeds maximum (%d bytes)", maxHeaderSize)
		}

		trimmed := strings.TrimRight(line, "\r\n")
		if trimmed == "" {
			return true, nil
		}

		separator := strings.IndexByte(trimmed, ':')
		if separator <= 0 {
			return false, nil
		}

		headerName := strings.ToLower(strings.TrimSpace(trimmed[:separator]))
		headerValue := strings.TrimSpace(trimmed[separator+1:])
		if headerName == "content-length" {
			length, parseErr := strconv.Atoi(headerValue)
			if parseErr != nil || length < 0 {
				return false, fmt.Errorf("invalid content-length: %s", headerValue)
			}
			if length > maxBodySize {
				return false, fmt.Errorf("content-length %d exceeds maximum %d", length, maxBodySize)
			}
			contentLength = length
		}

		return false, nil
	}

	ended, err := parseHeaderLine(firstLine)
	if err != nil {
		return nil, err
	}
	if ended {
		if contentLength < 0 {
			return nil, fmt.Errorf("missing content-length")
		}
		body := make([]byte, contentLength)
		if _, err := io.ReadFull(reader, body); err != nil {
			return nil, err
		}
		return body, nil
	}

	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return nil, err
		}

		ended, err := parseHeaderLine(line)
		if err != nil {
			return nil, err
		}
		if ended {
			break
		}
	}

	if contentLength < 0 {
		return nil, fmt.Errorf("missing content-length")
	}

	body := make([]byte, contentLength)
	if _, err := io.ReadFull(reader, body); err != nil {
		return nil, err
	}

	return body, nil
}

func formatToolResult(result any) string {
	if result == nil {
		return "{}"
	}

	if text, ok := result.(string); ok {
		return text
	}

	jsonResult, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return fmt.Sprintf("%v", result)
	}

	return string(jsonResult)
}
