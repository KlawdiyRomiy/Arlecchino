package mcp

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"testing"
)

func TestHandleRequestInitialize_AcceptsArbitraryProtocolVersion(t *testing.T) {
	service, err := NewToolService(t.TempDir())
	if err != nil {
		t.Fatalf("NewToolService() error = %v", err)
	}

	server := NewServer(service, strings.NewReader(""), io.Discard, io.Discard)
	params, err := json.Marshal(map[string]any{
		"protocolVersion": "2099-12-31",
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	result, rpcErr := server.handleRequest("initialize", params)
	if rpcErr != nil {
		t.Fatalf("handleRequest(initialize) unexpected error = %+v", rpcErr)
	}

	resultObject, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("handleRequest(initialize) result type = %T, want map[string]any", result)
	}
	if resultObject["protocolVersion"] != "2099-12-31" {
		t.Fatalf("handleRequest(initialize) protocolVersion = %v, want %q", resultObject["protocolVersion"], "2099-12-31")
	}
}

func TestHandleRequestInitialize_AcceptsMatchingProtocolVersion(t *testing.T) {
	service, err := NewToolService(t.TempDir())
	if err != nil {
		t.Fatalf("NewToolService() error = %v", err)
	}

	server := NewServer(service, strings.NewReader(""), io.Discard, io.Discard)
	params, err := json.Marshal(map[string]any{
		"protocolVersion": mcpProtocolVersion,
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	result, rpcErr := server.handleRequest("initialize", params)
	if rpcErr != nil {
		t.Fatalf("handleRequest(initialize) unexpected error = %+v", rpcErr)
	}

	resultObject, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("handleRequest(initialize) result type = %T, want map[string]any", result)
	}
	if resultObject["protocolVersion"] != mcpProtocolVersion {
		t.Fatalf("handleRequest(initialize) protocolVersion = %v, want %q", resultObject["protocolVersion"], mcpProtocolVersion)
	}
}

func TestHandleRequestInitialize_DefaultProtocolVersionWhenMissing(t *testing.T) {
	service, err := NewToolService(t.TempDir())
	if err != nil {
		t.Fatalf("NewToolService() error = %v", err)
	}

	server := NewServer(service, strings.NewReader(""), io.Discard, io.Discard)
	result, rpcErr := server.handleRequest("initialize", nil)
	if rpcErr != nil {
		t.Fatalf("handleRequest(initialize) unexpected error = %+v", rpcErr)
	}

	resultObject, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("handleRequest(initialize) result type = %T, want map[string]any", result)
	}
	if resultObject["protocolVersion"] != mcpProtocolVersion {
		t.Fatalf("handleRequest(initialize) protocolVersion = %v, want %q", resultObject["protocolVersion"], mcpProtocolVersion)
	}
}

func TestHandleRequestInitialize_IncludesProjectMemoryInstructions(t *testing.T) {
	service, err := NewToolService(t.TempDir())
	if err != nil {
		t.Fatalf("NewToolService() error = %v", err)
	}

	if _, err := service.SaveAgentMemory(
		"decision",
		[]string{"mcp"},
		"Remember project-local MCP continuity.",
		7,
	); err != nil {
		t.Fatalf("SaveAgentMemory() error = %v", err)
	}

	server := NewServer(service, strings.NewReader(""), io.Discard, io.Discard)
	result, rpcErr := server.handleRequest("initialize", nil)
	if rpcErr != nil {
		t.Fatalf("handleRequest(initialize) unexpected error = %+v", rpcErr)
	}

	resultObject, ok := result.(map[string]any)
	if !ok {
		t.Fatalf("handleRequest(initialize) result type = %T, want map[string]any", result)
	}
	instructions, ok := resultObject["instructions"].(string)
	if !ok {
		t.Fatalf("initialize instructions type = %T, want string", resultObject["instructions"])
	}
	if !strings.Contains(instructions, "Remember project-local MCP continuity.") {
		t.Fatalf("initialize instructions should include saved project memory, got %q", instructions)
	}
}

func TestReadFramedMessage_RejectsOversizedBody(t *testing.T) {
	input := fmt.Sprintf("Content-Length: %d\r\n\r\n{}", maxBodySize+1)
	reader := bufio.NewReader(strings.NewReader(input))

	_, err := readFramedMessage(reader)
	if err == nil {
		t.Fatalf("readFramedMessage() should reject oversized body")
	}
	if !strings.Contains(err.Error(), "exceeds maximum") {
		t.Fatalf("readFramedMessage() error = %v, want contains %q", err, "exceeds maximum")
	}
}

func TestReadFramedMessage_RejectsOversizedHeaders(t *testing.T) {
	oversizedHeader := strings.Repeat("x", maxHeaderSize+32)
	input := fmt.Sprintf("Content-Length: 2\r\nX-Test: %s\r\n\r\n{}", oversizedHeader)
	reader := bufio.NewReader(strings.NewReader(input))

	_, err := readFramedMessage(reader)
	if err == nil {
		t.Fatalf("readFramedMessage() should reject oversized headers")
	}
	if !strings.Contains(err.Error(), "header size exceeds") {
		t.Fatalf("readFramedMessage() error = %v, want contains %q", err, "header size exceeds")
	}
}

func TestReadFramedMessage_ValidPayload(t *testing.T) {
	input := "Content-Length: 11\r\n\r\n{\"ok\":true}"
	reader := bufio.NewReader(strings.NewReader(input))

	body, err := readFramedMessage(reader)
	if err != nil {
		t.Fatalf("readFramedMessage() error = %v", err)
	}
	if string(body) != "{\"ok\":true}" {
		t.Fatalf("readFramedMessage() body = %q, want %q", string(body), "{\"ok\":true}")
	}
}

func TestReadFramedMessage_LineDelimitedPayload(t *testing.T) {
	input := "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\n"
	reader := bufio.NewReader(strings.NewReader(input))

	body, err := readFramedMessage(reader)
	if err != nil {
		t.Fatalf("readFramedMessage() error = %v", err)
	}
	if string(body) != strings.TrimSpace(input) {
		t.Fatalf("readFramedMessage() body = %q, want %q", string(body), strings.TrimSpace(input))
	}
}

func TestReadIncomingMessage_DetectsLineDelimitedEncoding(t *testing.T) {
	input := "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\n"
	reader := bufio.NewReader(strings.NewReader(input))

	body, encoding, err := readIncomingMessage(reader)
	if err != nil {
		t.Fatalf("readIncomingMessage() error = %v", err)
	}
	if encoding != messageEncodingLineDelimited {
		t.Fatalf("readIncomingMessage() encoding = %v, want %v", encoding, messageEncodingLineDelimited)
	}
	if string(body) != strings.TrimSpace(input) {
		t.Fatalf("readIncomingMessage() body = %q, want %q", string(body), strings.TrimSpace(input))
	}
}

func TestWriteResponse_LineDelimitedEncoding(t *testing.T) {
	buffer := &bytes.Buffer{}
	service, err := NewToolService(t.TempDir())
	if err != nil {
		t.Fatalf("NewToolService() error = %v", err)
	}

	server := NewServer(service, strings.NewReader(""), buffer, io.Discard)
	if err := server.writeResponse(rpcResponse{
		JSONRPC: "2.0",
		ID:      json.RawMessage("1"),
		Result:  map[string]any{"ok": true},
	}, messageEncodingLineDelimited); err != nil {
		t.Fatalf("writeResponse() error = %v", err)
	}

	output := buffer.String()
	if strings.HasPrefix(strings.ToLower(output), "content-length:") {
		t.Fatalf("writeResponse(line-delimited) should not include content-length header")
	}
	if !strings.HasSuffix(output, "\n") {
		t.Fatalf("writeResponse(line-delimited) should end with newline")
	}

	var response rpcResponse
	if err := json.Unmarshal([]byte(strings.TrimSpace(output)), &response); err != nil {
		t.Fatalf("Unmarshal(response) error = %v", err)
	}
	if response.JSONRPC != "2.0" {
		t.Fatalf("response.jsonrpc = %q, want %q", response.JSONRPC, "2.0")
	}
}
