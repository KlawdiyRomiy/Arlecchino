package ai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"arlecchino/internal/ai/providers"

	"github.com/google/uuid"
)

const (
	managedMCPServersFileName = "managed_mcp_servers.jsonl"
	managedMCPToolsFileName   = "managed_mcp_tools.jsonl"
	managedMCPProtocolVersion = "2024-11-05"
	managedMCPRequestTimeout  = 30 * time.Second
	maxManagedMCPResponseSize = 1024 * 1024
)

var managedMCPEnvironmentName = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// ManagedMCPLedger is the host-owned MCP catalog. Credentials remain opaque
// secret references; server discovery and execution are never delegated to a
// provider transport.
type ManagedMCPLedger struct {
	mu          sync.Mutex
	serversPath string
	toolsPath   string
}

func openManagedMCPLedger(projectRoot string) (*ManagedMCPLedger, error) {
	serversPath, err := ledgerPath(projectRoot, managedMCPServersFileName)
	if err != nil {
		return nil, err
	}
	toolsPath, err := ledgerPath(projectRoot, managedMCPToolsFileName)
	if err != nil {
		return nil, err
	}
	return &ManagedMCPLedger{serversPath: serversPath, toolsPath: toolsPath}, nil
}

func (l *ManagedMCPLedger) ListServers() ([]AIMCPServerRecord, error) {
	if l == nil {
		return []AIMCPServerRecord{}, nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	servers, err := readJSONLLocked[AIMCPServerRecord](l.serversPath)
	if err != nil {
		return nil, err
	}
	for index := range servers {
		servers[index] = normalizeManagedMCPServer(servers[index])
	}
	sort.SliceStable(servers, func(i, j int) bool { return servers[i].ID < servers[j].ID })
	return servers, nil
}

func (l *ManagedMCPLedger) GetServer(serverID string) (AIMCPServerRecord, bool, error) {
	if l == nil {
		return AIMCPServerRecord{}, false, nil
	}
	serverID = strings.TrimSpace(serverID)
	l.mu.Lock()
	defer l.mu.Unlock()
	servers, err := readJSONLLocked[AIMCPServerRecord](l.serversPath)
	if err != nil {
		return AIMCPServerRecord{}, false, err
	}
	for _, server := range servers {
		if server.ID == serverID {
			return normalizeManagedMCPServer(server), true, nil
		}
	}
	return AIMCPServerRecord{}, false, nil
}

func (l *ManagedMCPLedger) UpsertServer(server AIMCPServerRecord) (AIMCPServerRecord, error) {
	if l == nil {
		return AIMCPServerRecord{}, fmt.Errorf("managed MCP registry is unavailable")
	}
	server = normalizeManagedMCPServer(server)
	l.mu.Lock()
	defer l.mu.Unlock()
	servers, err := readJSONLLocked[AIMCPServerRecord](l.serversPath)
	if err != nil {
		return AIMCPServerRecord{}, err
	}
	for index := range servers {
		if servers[index].ID == server.ID {
			server.CreatedAt = firstNonEmpty(servers[index].CreatedAt, server.CreatedAt)
			servers[index] = server
			return server, writeJSONLLocked(l.serversPath, servers)
		}
	}
	servers = append(servers, server)
	sort.SliceStable(servers, func(i, j int) bool { return servers[i].ID < servers[j].ID })
	return server, writeJSONLLocked(l.serversPath, servers)
}

func (l *ManagedMCPLedger) ListTools(serverID string) ([]AIMCPManagedTool, error) {
	if l == nil {
		return []AIMCPManagedTool{}, nil
	}
	serverID = strings.TrimSpace(serverID)
	l.mu.Lock()
	defer l.mu.Unlock()
	tools, err := readJSONLLocked[AIMCPManagedTool](l.toolsPath)
	if err != nil {
		return nil, err
	}
	result := make([]AIMCPManagedTool, 0, len(tools))
	for _, tool := range tools {
		if serverID == "" || tool.ServerID == serverID {
			result = append(result, normalizeManagedMCPTool(tool))
		}
	}
	sort.SliceStable(result, func(i, j int) bool {
		if result[i].ServerID != result[j].ServerID {
			return result[i].ServerID < result[j].ServerID
		}
		return result[i].Name < result[j].Name
	})
	return result, nil
}

func (l *ManagedMCPLedger) GetTool(serverID, toolName string) (AIMCPManagedTool, bool, error) {
	tools, err := l.ListTools(serverID)
	if err != nil {
		return AIMCPManagedTool{}, false, err
	}
	for _, tool := range tools {
		if tool.Name == strings.TrimSpace(toolName) {
			return tool, true, nil
		}
	}
	return AIMCPManagedTool{}, false, nil
}

func (l *ManagedMCPLedger) ReplaceTools(serverID string, next []AIMCPManagedTool) ([]AIMCPManagedTool, error) {
	if l == nil {
		return nil, fmt.Errorf("managed MCP registry is unavailable")
	}
	serverID = strings.TrimSpace(serverID)
	l.mu.Lock()
	defer l.mu.Unlock()
	tools, err := readJSONLLocked[AIMCPManagedTool](l.toolsPath)
	if err != nil {
		return nil, err
	}
	kept := make([]AIMCPManagedTool, 0, len(tools)+len(next))
	for _, tool := range tools {
		if tool.ServerID != serverID {
			kept = append(kept, tool)
		}
	}
	normalized := make([]AIMCPManagedTool, 0, len(next))
	for _, tool := range next {
		tool.ServerID = serverID
		tool = normalizeManagedMCPTool(tool)
		normalized = append(normalized, tool)
		kept = append(kept, tool)
	}
	sort.SliceStable(kept, func(i, j int) bool {
		if kept[i].ServerID != kept[j].ServerID {
			return kept[i].ServerID < kept[j].ServerID
		}
		return kept[i].Name < kept[j].Name
	})
	return normalized, writeJSONLLocked(l.toolsPath, kept)
}

func (l *ManagedMCPLedger) SetToolEnabled(serverID, toolName string, enabled bool) (AIMCPManagedTool, error) {
	if l == nil {
		return AIMCPManagedTool{}, fmt.Errorf("managed MCP registry is unavailable")
	}
	serverID, toolName = strings.TrimSpace(serverID), strings.TrimSpace(toolName)
	l.mu.Lock()
	defer l.mu.Unlock()
	tools, err := readJSONLLocked[AIMCPManagedTool](l.toolsPath)
	if err != nil {
		return AIMCPManagedTool{}, err
	}
	for index := range tools {
		if tools[index].ServerID != serverID || tools[index].Name != toolName {
			continue
		}
		tools[index].Enabled = enabled
		tools[index].UpdatedAt = utcNow()
		tool := normalizeManagedMCPTool(tools[index])
		tools[index] = tool
		return tool, writeJSONLLocked(l.toolsPath, tools)
	}
	return AIMCPManagedTool{}, fmt.Errorf("managed MCP tool %q was not found", toolName)
}

func (s *Service) UpsertManagedMCPServer(projectID string, server AIMCPServerRecord) (AIMCPServerRecord, error) {
	project := s.project(normalizeProjectID(projectID))
	if project == nil || project.ManagedMCP == nil {
		return AIMCPServerRecord{}, fmt.Errorf("AI project session is not open")
	}
	if err := validateManagedMCPServer(server); err != nil {
		return AIMCPServerRecord{}, err
	}
	server.ConsentRequired = true
	server.Enabled = false
	server.Health = "unverified"
	server.HealthReason = "server registration is metadata-only until an explicit health check"
	server.UpdatedAt = utcNow()
	stored, err := project.ManagedMCP.UpsertServer(server)
	if err == nil {
		s.emitEvent("ai:mcp:server:changed", stored)
	}
	return stored, err
}

func (s *Service) SetManagedMCPServerEnabled(projectID, serverID string, enabled bool) (AIMCPServerRecord, error) {
	project := s.project(normalizeProjectID(projectID))
	if project == nil || project.ManagedMCP == nil {
		return AIMCPServerRecord{}, fmt.Errorf("AI project session is not open")
	}
	server, found, err := project.ManagedMCP.GetServer(serverID)
	if err != nil {
		return AIMCPServerRecord{}, err
	}
	if !found {
		return AIMCPServerRecord{}, fmt.Errorf("managed MCP server %q is not registered", strings.TrimSpace(serverID))
	}
	if enabled && server.Health != "healthy" {
		return AIMCPServerRecord{}, fmt.Errorf("managed MCP server %q must pass an explicit health check before it can be enabled", server.ID)
	}
	server.Enabled = enabled
	server.UpdatedAt = utcNow()
	stored, err := project.ManagedMCP.UpsertServer(server)
	if err == nil {
		s.emitEvent("ai:mcp:server:changed", stored)
	}
	return stored, err
}

func (s *Service) ListManagedMCPServers(projectID string) ([]AIMCPServerRecord, error) {
	project := s.project(normalizeProjectID(projectID))
	if project == nil || project.ManagedMCP == nil {
		return []AIMCPServerRecord{}, nil
	}
	return project.ManagedMCP.ListServers()
}

func (s *Service) ListManagedMCPTools(projectID, serverID string) ([]AIMCPManagedTool, error) {
	project := s.project(normalizeProjectID(projectID))
	if project == nil || project.ManagedMCP == nil {
		return []AIMCPManagedTool{}, nil
	}
	return project.ManagedMCP.ListTools(serverID)
}

func (s *Service) SetManagedMCPToolEnabled(projectID, serverID, toolName string, enabled bool) (AIMCPManagedTool, error) {
	project := s.project(normalizeProjectID(projectID))
	if project == nil || project.ManagedMCP == nil {
		return AIMCPManagedTool{}, fmt.Errorf("AI project session is not open")
	}
	server, found, err := project.ManagedMCP.GetServer(serverID)
	if err != nil {
		return AIMCPManagedTool{}, err
	}
	if !found || !server.Enabled || server.Health != "healthy" {
		return AIMCPManagedTool{}, fmt.Errorf("managed MCP server must be enabled and healthy before a tool can be enabled")
	}
	tool, err := project.ManagedMCP.SetToolEnabled(server.ID, toolName, enabled)
	if err == nil {
		s.emitEvent("ai:mcp:tools:changed", []AIMCPManagedTool{tool})
	}
	return tool, err
}

// DiscoverManagedMCPTools performs the explicit health/discovery request. It
// never silently probes a remote endpoint while building model context: the
// user-facing discovery action is the consent boundary for this metadata-only
// egress.
func (s *Service) DiscoverManagedMCPTools(ctx context.Context, projectID, serverID string) (AIMCPManagedDiscoveryResult, error) {
	project := s.project(normalizeProjectID(projectID))
	if project == nil || project.ManagedMCP == nil {
		return AIMCPManagedDiscoveryResult{}, fmt.Errorf("AI project session is not open")
	}
	server, found, err := project.ManagedMCP.GetServer(serverID)
	if err != nil {
		return AIMCPManagedDiscoveryResult{}, err
	}
	if !found {
		return AIMCPManagedDiscoveryResult{}, fmt.Errorf("managed MCP server %q is not registered", strings.TrimSpace(serverID))
	}
	tools, protocolVersion, discoverErr := s.discoverManagedMCPTools(ctx, server)
	now := utcNow()
	server.LastHealthCheckedAt = now
	server.UpdatedAt = now
	if discoverErr != nil {
		server.Health = "error"
		server.HealthReason = sanitizedDisplayText(discoverErr.Error())
		server.Enabled = false
		stored, storeErr := project.ManagedMCP.UpsertServer(server)
		if storeErr != nil {
			return AIMCPManagedDiscoveryResult{}, storeErr
		}
		s.emitEvent("ai:mcp:server:changed", stored)
		return AIMCPManagedDiscoveryResult{Server: stored, Tools: []AIMCPManagedTool{}, Status: "error", Error: server.HealthReason}, nil
	}
	server.Health = "healthy"
	server.HealthReason = "tool schemas discovered through host-managed " + string(server.Transport) + " client"
	server.ProtocolVersion = protocolVersion
	server.DiscoveredAt = now
	stored, err := project.ManagedMCP.UpsertServer(server)
	if err != nil {
		return AIMCPManagedDiscoveryResult{}, err
	}
	tools, err = project.ManagedMCP.ReplaceTools(server.ID, tools)
	if err != nil {
		return AIMCPManagedDiscoveryResult{}, err
	}
	s.emitEvent("ai:mcp:server:changed", stored)
	s.emitEvent("ai:mcp:tools:changed", tools)
	return AIMCPManagedDiscoveryResult{Server: stored, Tools: tools, Status: "healthy"}, nil
}

func (s *Service) executeManagedMCPTool(ctx context.Context, project *ProjectSession, req AIToolCallRequest, serverID, toolName string, arguments map[string]any) (any, error) {
	if project == nil || project.ManagedMCP == nil {
		return nil, fmt.Errorf("managed MCP registry is unavailable")
	}
	server, found, err := project.ManagedMCP.GetServer(serverID)
	if err != nil {
		return nil, err
	}
	if !found || !server.Enabled || server.Health != "healthy" {
		return nil, fmt.Errorf("managed MCP server %q is not enabled and healthy", strings.TrimSpace(serverID))
	}
	tool, found, err := project.ManagedMCP.GetTool(server.ID, toolName)
	if err != nil {
		return nil, err
	}
	if !found || !tool.Enabled {
		return nil, fmt.Errorf("managed MCP tool %q is not enabled", strings.TrimSpace(toolName))
	}

	started := time.Now()
	output, callErr := s.callManagedMCPTool(ctx, server, tool.Name, arguments)
	s.recordManagedMCPEgress(project, req, server, tool, arguments, output, callErr, time.Since(started))
	return output, callErr
}

type managedMCPRPCRequest struct {
	JSONRPC string `json:"jsonrpc"`
	ID      int    `json:"id,omitempty"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
}

type managedMCPRPCResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      int             `json:"id"`
	Result  json.RawMessage `json:"result"`
	Error   *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

func (s *Service) discoverManagedMCPTools(ctx context.Context, server AIMCPServerRecord) ([]AIMCPManagedTool, string, error) {
	result, err := s.managedMCPRequest(ctx, server, "tools/list", map[string]any{})
	if err != nil {
		return nil, "", err
	}
	var payload struct {
		Tools []struct {
			Name        string          `json:"name"`
			Description string          `json:"description"`
			InputSchema json.RawMessage `json:"inputSchema"`
		} `json:"tools"`
	}
	if err := json.Unmarshal(result, &payload); err != nil {
		return nil, "", fmt.Errorf("managed MCP tools/list response is invalid: %w", err)
	}
	now := utcNow()
	tools := make([]AIMCPManagedTool, 0, len(payload.Tools))
	for _, discovered := range payload.Tools {
		name := strings.TrimSpace(discovered.Name)
		if name == "" {
			continue
		}
		class := classifyMCPSubtool(name)
		tools = append(tools, AIMCPManagedTool{
			ServerID:        server.ID,
			Name:            name,
			Description:     sanitizedDisplayText(discovered.Description),
			InputSchemaJSON: string(discovered.InputSchema),
			RiskLevel:       class.RiskLevel,
			ApprovalMode:    class.ApprovalMode,
			Enabled:         false,
			MetadataOnly:    true,
			DiscoveredAt:    now,
			UpdatedAt:       now,
		})
	}
	return tools, managedMCPProtocolVersion, nil
}

func (s *Service) callManagedMCPTool(ctx context.Context, server AIMCPServerRecord, toolName string, arguments map[string]any) (any, error) {
	result, err := s.managedMCPRequest(ctx, server, "tools/call", map[string]any{"name": toolName, "arguments": arguments})
	if err != nil {
		return nil, err
	}
	var decoded any
	if err := json.Unmarshal(result, &decoded); err != nil {
		return string(result), nil
	}
	return decoded, nil
}

// managedMCPRequest owns the complete initialize/initialized/request exchange.
// It intentionally has no provider callback path: every managed server uses the
// same host-owned transport, authorization, timeout, and response validation.
func (s *Service) managedMCPRequest(ctx context.Context, server AIMCPServerRecord, method string, params any) (json.RawMessage, error) {
	switch server.Transport {
	case AIMCPServerTransportStdio:
		return s.managedMCPStdioRequest(ctx, server, method, params)
	case AIMCPServerTransportHTTP:
		return s.managedMCPHTTPRequest(ctx, server, method, params)
	case AIMCPServerTransportSSE:
		return s.managedMCPSSERequest(ctx, server, method, params)
	default:
		return nil, fmt.Errorf("unsupported managed MCP transport %q", server.Transport)
	}
}

type managedMCPAuthorization struct {
	Headers     map[string]string
	Environment map[string]string
}

// resolveManagedMCPAuthorization resolves only an opaque keychain/secret-store
// reference. Neither the reference's value nor derived auth headers are stored
// in the MCP catalog, artifacts, tool audit, errors, or provider context.
func (s *Service) resolveManagedMCPAuthorization(ctx context.Context, server AIMCPServerRecord) (managedMCPAuthorization, error) {
	if strings.TrimSpace(server.AuthSecretRef) == "" {
		return managedMCPAuthorization{}, nil
	}
	if s == nil || s.secretStore == nil {
		return managedMCPAuthorization{}, fmt.Errorf("managed MCP auth secret resolver is unavailable")
	}
	secret, err := s.secretStore.FindSecret(ctx, server.AuthSecretRef)
	if err != nil {
		return managedMCPAuthorization{}, fmt.Errorf("managed MCP auth secret could not be resolved")
	}
	return managedMCPAuthorizationFromSecret(secret)
}

// A secret may be an opaque bearer token, or a JSON document with explicitly
// named headers/environment variables. The latter is useful for standards such
// as API-key headers while remaining entirely in the injected secret store.
func managedMCPAuthorizationFromSecret(secret string) (managedMCPAuthorization, error) {
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return managedMCPAuthorization{}, fmt.Errorf("managed MCP auth secret is empty")
	}
	var structured struct {
		Headers     map[string]string `json:"headers"`
		Environment map[string]string `json:"environment"`
	}
	if strings.HasPrefix(secret, "{") && json.Unmarshal([]byte(secret), &structured) == nil && (len(structured.Headers) > 0 || len(structured.Environment) > 0) {
		auth := managedMCPAuthorization{Headers: map[string]string{}, Environment: map[string]string{}}
		for key, value := range structured.Headers {
			key, value = http.CanonicalHeaderKey(strings.TrimSpace(key)), strings.TrimSpace(value)
			if key == "" || value == "" || strings.ContainsAny(key, "\r\n") || strings.ContainsAny(value, "\r\n") {
				return managedMCPAuthorization{}, fmt.Errorf("managed MCP auth secret has an invalid header")
			}
			auth.Headers[key] = value
		}
		for key, value := range structured.Environment {
			key, value = strings.TrimSpace(key), strings.TrimSpace(value)
			if !managedMCPEnvironmentName.MatchString(key) || value == "" || strings.ContainsAny(value, "\x00\r\n") {
				return managedMCPAuthorization{}, fmt.Errorf("managed MCP auth secret has an invalid environment value")
			}
			auth.Environment[key] = value
		}
		return auth, nil
	}
	bearer := secret
	if !strings.HasPrefix(strings.ToLower(bearer), "bearer ") {
		bearer = "Bearer " + bearer
	}
	return managedMCPAuthorization{
		Headers:     map[string]string{"Authorization": bearer},
		Environment: map[string]string{"MCP_AUTH_TOKEN": secret},
	}, nil
}

func (s *Service) managedMCPStdioRequest(ctx context.Context, server AIMCPServerRecord, method string, params any) (json.RawMessage, error) {
	if server.Transport != AIMCPServerTransportStdio || len(server.Command) == 0 || strings.TrimSpace(server.Command[0]) == "" {
		return nil, fmt.Errorf("managed MCP stdio server command is not configured")
	}
	ctx, cancel := context.WithTimeout(ctx, managedMCPRequestTimeout)
	defer cancel()
	auth, err := s.resolveManagedMCPAuthorization(ctx, server)
	if err != nil {
		return nil, err
	}
	command := exec.CommandContext(ctx, server.Command[0], server.Command[1:]...)
	if len(auth.Environment) > 0 {
		command.Env = append([]string{}, os.Environ()...)
		for key, value := range auth.Environment {
			command.Env = append(command.Env, key+"="+value)
		}
	}
	stdin, err := command.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := command.Start(); err != nil {
		return nil, err
	}
	defer func() {
		_ = stdin.Close()
		if command.Process != nil {
			_ = command.Process.Kill()
		}
		_ = command.Wait()
	}()
	encoder := json.NewEncoder(stdin)
	if err := encoder.Encode(managedMCPRPCRequest{JSONRPC: "2.0", ID: 1, Method: "initialize", Params: map[string]any{
		"protocolVersion": managedMCPProtocolVersion,
		"capabilities":    map[string]any{},
		"clientInfo":      map[string]string{"name": "Arlecchino", "version": "1"},
	}}); err != nil {
		return nil, err
	}
	reader := bufio.NewScanner(stdout)
	reader.Buffer(make([]byte, 0, 4096), 1<<20)
	if _, err := waitManagedMCPResponse(ctx, reader, 1); err != nil {
		return nil, err
	}
	if err := encoder.Encode(managedMCPRPCRequest{JSONRPC: "2.0", Method: "notifications/initialized"}); err != nil {
		return nil, err
	}
	if err := encoder.Encode(managedMCPRPCRequest{JSONRPC: "2.0", ID: 2, Method: method, Params: params}); err != nil {
		return nil, err
	}
	result, err := waitManagedMCPResponse(ctx, reader, 2)
	if err != nil {
		return nil, err
	}
	return result, nil
}

func waitManagedMCPResponse(ctx context.Context, scanner *bufio.Scanner, expectedID int) (json.RawMessage, error) {
	for {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if !scanner.Scan() {
			if err := scanner.Err(); err != nil {
				return nil, err
			}
			return nil, fmt.Errorf("managed MCP server closed stdout before responding")
		}
		result, matched, err := managedMCPResultFromRPCPayload(scanner.Bytes(), expectedID)
		if err != nil {
			return nil, err
		}
		if !matched {
			continue // notifications and other request IDs are not this request's result.
		}
		return result, nil
	}
}

func managedMCPResultFromRPCPayload(payload []byte, expectedID int) (json.RawMessage, bool, error) {
	var response managedMCPRPCResponse
	if err := json.Unmarshal(payload, &response); err != nil || response.ID != expectedID {
		return nil, false, nil
	}
	if response.Error != nil {
		return nil, true, fmt.Errorf("managed MCP error %d: %s", response.Error.Code, sanitizedDisplayText(response.Error.Message))
	}
	return response.Result, true, nil
}

type managedMCPHTTPClient struct {
	client *http.Client
	auth   managedMCPAuthorization
}

func (s *Service) managedMCPClient(ctx context.Context, server AIMCPServerRecord) (managedMCPHTTPClient, error) {
	auth, err := s.resolveManagedMCPAuthorization(ctx, server)
	if err != nil {
		return managedMCPHTTPClient{}, err
	}
	return managedMCPHTTPClient{
		client: &http.Client{
			Timeout: managedMCPRequestTimeout,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				// A redirect can turn a reviewed endpoint into a different egress.
				return http.ErrUseLastResponse
			},
		},
		auth: auth,
	}, nil
}

func (c managedMCPHTTPClient) applyHeaders(request *http.Request) {
	for key, value := range c.auth.Headers {
		request.Header.Set(key, value)
	}
}

func (s *Service) managedMCPHTTPRequest(ctx context.Context, server AIMCPServerRecord, method string, params any) (json.RawMessage, error) {
	endpoint, err := validateManagedMCPEndpoint(server.Endpoint)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, managedMCPRequestTimeout)
	defer cancel()
	client, err := s.managedMCPClient(ctx, server)
	if err != nil {
		return nil, err
	}

	initialize, headers, err := client.postRPC(ctx, endpoint.String(), managedMCPRPCRequest{
		JSONRPC: "2.0",
		ID:      1,
		Method:  "initialize",
		Params: map[string]any{
			"protocolVersion": managedMCPProtocolVersion,
			"capabilities":    map[string]any{},
			"clientInfo":      map[string]string{"name": "Arlecchino", "version": "1"},
		},
	}, "", true)
	if err != nil {
		return nil, err
	}
	if _, matched, err := managedMCPResultFromRPCPayload(initialize, 1); err != nil || !matched {
		if err != nil {
			return nil, err
		}
		return nil, fmt.Errorf("managed MCP HTTP initialize response is invalid")
	}
	sessionID := strings.TrimSpace(headers.Get("Mcp-Session-Id"))
	if _, _, err := client.postRPC(ctx, endpoint.String(), managedMCPRPCRequest{JSONRPC: "2.0", Method: "notifications/initialized"}, sessionID, false); err != nil {
		return nil, err
	}
	response, _, err := client.postRPC(ctx, endpoint.String(), managedMCPRPCRequest{JSONRPC: "2.0", ID: 2, Method: method, Params: params}, sessionID, true)
	if err != nil {
		return nil, err
	}
	result, matched, err := managedMCPResultFromRPCPayload(response, 2)
	if err != nil {
		return nil, err
	}
	if !matched {
		return nil, fmt.Errorf("managed MCP HTTP response is invalid")
	}
	return result, nil
}

func (c managedMCPHTTPClient) postRPC(ctx context.Context, endpoint string, payload managedMCPRPCRequest, sessionID string, requireResponse bool) ([]byte, http.Header, error) {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return nil, nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(encoded))
	if err != nil {
		return nil, nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json, text/event-stream")
	request.Header.Set("MCP-Protocol-Version", managedMCPProtocolVersion)
	request.Header.Set("User-Agent", "Arlecchino-Managed-MCP/1")
	if sessionID != "" {
		request.Header.Set("Mcp-Session-Id", sessionID)
	}
	c.applyHeaders(request)
	response, err := c.client.Do(request)
	if err != nil {
		return nil, nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, response.Header, fmt.Errorf("managed MCP HTTP request failed with status %d", response.StatusCode)
	}
	if !requireResponse || response.StatusCode == http.StatusAccepted || response.StatusCode == http.StatusNoContent {
		return nil, response.Header, nil
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxManagedMCPResponseSize+1))
	if err != nil {
		return nil, response.Header, err
	}
	if len(body) > maxManagedMCPResponseSize {
		return nil, response.Header, fmt.Errorf("managed MCP HTTP response exceeded the bounded artifact limit")
	}
	if strings.Contains(strings.ToLower(response.Header.Get("Content-Type")), "text/event-stream") {
		ssePayload, err := managedMCPRPCPayloadFromSSE(bytes.NewReader(body), payload.ID)
		return ssePayload, response.Header, err
	}
	return body, response.Header, nil
}

// managedMCPRPCPayloadFromSSE accepts the first valid JSON-RPC payload in a
// finite Streamable HTTP response. Long-lived SSE uses the same event parser
// below, but this variant is deliberately bounded before it becomes an artifact.
func managedMCPRPCPayloadFromSSE(reader io.Reader, expectedID int) ([]byte, error) {
	buffered := bufio.NewReader(reader)
	for {
		_, data, err := readManagedMCPSSERawEvent(buffered)
		if err != nil {
			return nil, err
		}
		if _, matched, _ := managedMCPResultFromRPCPayload(data, expectedID); matched {
			return data, nil
		}
	}
}

// managedMCPSSERequest implements the legacy MCP SSE transport. Its endpoint
// event can carry a temporary message URL, so it is kept only in memory and is
// constrained to the reviewed server origin before a request is posted.
func (s *Service) managedMCPSSERequest(ctx context.Context, server AIMCPServerRecord, method string, params any) (json.RawMessage, error) {
	endpoint, err := validateManagedMCPEndpoint(server.Endpoint)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, managedMCPRequestTimeout)
	defer cancel()
	client, err := s.managedMCPClient(ctx, server)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "text/event-stream")
	request.Header.Set("Cache-Control", "no-cache")
	request.Header.Set("User-Agent", "Arlecchino-Managed-MCP/1")
	client.applyHeaders(request)
	response, err := client.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || !strings.Contains(strings.ToLower(response.Header.Get("Content-Type")), "text/event-stream") {
		return nil, fmt.Errorf("managed MCP SSE endpoint did not return an event stream")
	}
	reader := bufio.NewReader(response.Body)
	messageURL, err := managedMCPSSEMessageEndpoint(endpoint, reader)
	if err != nil {
		return nil, err
	}
	if err := client.postSSE(ctx, messageURL, managedMCPRPCRequest{
		JSONRPC: "2.0",
		ID:      1,
		Method:  "initialize",
		Params: map[string]any{
			"protocolVersion": managedMCPProtocolVersion,
			"capabilities":    map[string]any{},
			"clientInfo":      map[string]string{"name": "Arlecchino", "version": "1"},
		},
	}); err != nil {
		return nil, err
	}
	if _, err := readManagedMCPSSEResponse(reader, 1); err != nil {
		return nil, err
	}
	if err := client.postSSE(ctx, messageURL, managedMCPRPCRequest{JSONRPC: "2.0", Method: "notifications/initialized"}); err != nil {
		return nil, err
	}
	if err := client.postSSE(ctx, messageURL, managedMCPRPCRequest{JSONRPC: "2.0", ID: 2, Method: method, Params: params}); err != nil {
		return nil, err
	}
	return readManagedMCPSSEResponse(reader, 2)
}

func (c managedMCPHTTPClient) postSSE(ctx context.Context, endpoint string, payload managedMCPRPCRequest) error {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(encoded))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	request.Header.Set("MCP-Protocol-Version", managedMCPProtocolVersion)
	request.Header.Set("User-Agent", "Arlecchino-Managed-MCP/1")
	c.applyHeaders(request)
	response, err := c.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return fmt.Errorf("managed MCP SSE message request failed with status %d", response.StatusCode)
	}
	return nil
}

func managedMCPSSEMessageEndpoint(serverEndpoint *url.URL, reader *bufio.Reader) (string, error) {
	for {
		event, data, err := readManagedMCPSSERawEvent(reader)
		if err != nil {
			return "", err
		}
		if event != "endpoint" {
			continue
		}
		candidate, err := serverEndpoint.Parse(strings.TrimSpace(string(data)))
		if err != nil || candidate == nil || candidate.Scheme == "" || candidate.Host == "" || candidate.User != nil {
			return "", fmt.Errorf("managed MCP SSE endpoint event is invalid")
		}
		if candidate.Scheme != serverEndpoint.Scheme || !strings.EqualFold(candidate.Host, serverEndpoint.Host) {
			return "", fmt.Errorf("managed MCP SSE endpoint attempted to change the reviewed origin")
		}
		return candidate.String(), nil
	}
}

func readManagedMCPSSEResponse(reader *bufio.Reader, expectedID int) (json.RawMessage, error) {
	for {
		_, data, err := readManagedMCPSSERawEvent(reader)
		if err != nil {
			return nil, err
		}
		result, matched, err := managedMCPResultFromRPCPayload(data, expectedID)
		if err != nil {
			return nil, err
		}
		if matched {
			return result, nil
		}
	}
}

func readManagedMCPSSERawEvent(reader *bufio.Reader) (string, []byte, error) {
	event := "message"
	data := []string{}
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			if err == io.EOF && len(data) > 0 {
				return event, []byte(strings.Join(data, "\n")), nil
			}
			return "", nil, err
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			if len(data) == 0 {
				continue
			}
			return event, []byte(strings.Join(data, "\n")), nil
		}
		if strings.HasPrefix(line, ":") {
			continue
		}
		field, value, found := strings.Cut(line, ":")
		if !found {
			continue
		}
		value = strings.TrimPrefix(value, " ")
		switch field {
		case "event":
			event = value
		case "data":
			data = append(data, value)
		}
	}
}

func validateManagedMCPServer(server AIMCPServerRecord) error {
	if !agentPluginIDPattern.MatchString(strings.TrimSpace(server.ID)) || strings.TrimSpace(server.Name) == "" {
		return fmt.Errorf("managed MCP server requires a stable lowercase id and name")
	}
	switch server.Transport {
	case AIMCPServerTransportStdio:
		if len(server.Command) == 0 || strings.TrimSpace(server.Command[0]) == "" {
			return fmt.Errorf("managed MCP stdio server requires a command")
		}
	case AIMCPServerTransportHTTP, AIMCPServerTransportSSE:
		if _, err := validateManagedMCPEndpoint(server.Endpoint); err != nil {
			return fmt.Errorf("managed MCP %s server endpoint: %w", server.Transport, err)
		}
	default:
		return fmt.Errorf("unsupported managed MCP transport %q", server.Transport)
	}
	return nil
}

func validateManagedMCPEndpoint(endpoint string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(endpoint))
	if err != nil || parsed == nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("must be an absolute http or https URL")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("must use http or https")
	}
	if parsed.User != nil {
		return nil, fmt.Errorf("must not include credentials")
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, fmt.Errorf("must not include query strings or fragments; use an opaque auth secret reference")
	}
	if parsed.Scheme == "http" && !isLoopbackEndpoint(parsed.String()) {
		return nil, fmt.Errorf("remote endpoints must use HTTPS")
	}
	return parsed, nil
}

func normalizeManagedMCPServer(server AIMCPServerRecord) AIMCPServerRecord {
	server.ID = strings.TrimSpace(server.ID)
	server.Name = strings.TrimSpace(server.Name)
	server.Endpoint = strings.TrimSpace(server.Endpoint)
	server.AuthSecretRef = strings.TrimSpace(server.AuthSecretRef)
	server.Health = firstNonEmpty(strings.TrimSpace(server.Health), "unverified")
	server.HealthReason = sanitizedDisplayText(server.HealthReason)
	server.ProtocolVersion = strings.TrimSpace(server.ProtocolVersion)
	server.CreatedAt = firstNonEmpty(server.CreatedAt, utcNow())
	server.UpdatedAt = firstNonEmpty(server.UpdatedAt, server.CreatedAt)
	return server
}

func normalizeManagedMCPTool(tool AIMCPManagedTool) AIMCPManagedTool {
	tool.ServerID = strings.TrimSpace(tool.ServerID)
	tool.Name = strings.TrimSpace(tool.Name)
	tool.Description = sanitizedDisplayText(tool.Description)
	if tool.RiskLevel == "" {
		tool.RiskLevel = AIToolRiskMedium
	}
	if tool.ApprovalMode == "" {
		tool.ApprovalMode = AIApprovalModeAskEachTime
	}
	tool.DiscoveredAt = firstNonEmpty(tool.DiscoveredAt, utcNow())
	tool.UpdatedAt = firstNonEmpty(tool.UpdatedAt, tool.DiscoveredAt)
	return tool
}

// applyManagedMCPToolProposal is intentionally called before generic approval
// evaluation. The catalog's discovered classification is authoritative for a
// managed server; global Full Access can never turn it into silent network
// egress, because every managed call remains AskEachTime.
func (s *Service) applyManagedMCPToolProposal(project *ProjectSession, req AIToolCallRequest, proposal AIToolProposal) AIToolProposal {
	if s == nil || project == nil || project.ManagedMCP == nil || req.ToolID != "mcp.execute" {
		return proposal
	}
	serverID := strings.TrimSpace(req.Arguments["serverId"])
	if serverID == "" {
		return proposal
	}
	proposal.Policy = AIToolPolicyApprovalRequired
	proposal.ApprovalModeRequired = AIApprovalModeAskEachTime
	proposal.AllowedByCurrentPolicy = false
	server, found, err := project.ManagedMCP.GetServer(serverID)
	if err != nil || !found {
		proposal.ScopeSummary = "Managed MCP server " + serverID + ": registration must be reviewed before egress"
		proposal.RiskLevel = AIToolRiskHigh
		return proposal
	}
	toolName := strings.TrimSpace(firstNonEmpty(req.Arguments["tool"], req.Arguments["name"]))
	tool, found, err := project.ManagedMCP.GetTool(server.ID, toolName)
	if err != nil || !found {
		proposal.ScopeSummary = "Managed MCP server " + server.ID + ": tool " + firstNonEmpty(toolName, "unknown") + " must be discovered and enabled before egress"
		proposal.RiskLevel = AIToolRiskHigh
		return proposal
	}
	proposal.MCPToolName = tool.Name
	proposal.RiskLevel = tool.RiskLevel
	proposal.ScopeSummary = fmt.Sprintf("Managed MCP server %s: %s (catalog approval=%s; explicit per-egress consent required)", server.ID, classifyMCPSubtool(tool.Name).ScopeSummary(tool.Name), tool.ApprovalMode)
	return proposal
}

func managedMCPRequiresPerEgressConsent(req AIToolCallRequest) bool {
	return req.ToolID == "mcp.execute" && strings.TrimSpace(req.Arguments["serverId"]) != ""
}

// managedMCPMetadataPlane exposes only capability counts. It deliberately
// omits endpoints, auth references, schemas, arguments, and results so Include
// MCP never turns a managed server into raw model context.
func managedMCPMetadataPlane(project *ProjectSession) (AIMCPContextPlane, bool) {
	if project == nil || project.ManagedMCP == nil {
		return AIMCPContextPlane{}, false
	}
	servers, err := project.ManagedMCP.ListServers()
	if err != nil || len(servers) == 0 {
		return AIMCPContextPlane{}, false
	}
	plane := AIMCPContextPlane{Available: true, ExecutionState: "managed metadata only; tool egress requires explicit per-call consent"}
	for _, server := range servers {
		if server.Enabled && server.Health == "healthy" {
			plane.Enabled = true
		}
		tools, listErr := project.ManagedMCP.ListTools(server.ID)
		if listErr != nil {
			continue
		}
		plane.ToolCount += len(tools)
		for _, tool := range tools {
			if tool.Enabled {
				plane.EnabledToolCount++
			} else {
				plane.DisabledToolCount++
			}
		}
	}
	plane.ToolGroups = []AIMCPToolGroupSummary{{
		Name:     "Managed MCP",
		Total:    plane.ToolCount,
		Enabled:  plane.EnabledToolCount,
		Disabled: plane.DisabledToolCount,
	}}
	return plane, true
}

func mergeMCPMetadataPlanes(base AIMCPContextPlane, managed AIMCPContextPlane) AIMCPContextPlane {
	if !managed.Available {
		return base
	}
	if !base.Available {
		return managed
	}
	base.Enabled = base.Enabled || managed.Enabled
	base.Available = true
	base.ToolCount += managed.ToolCount
	base.EnabledToolCount += managed.EnabledToolCount
	base.DisabledToolCount += managed.DisabledToolCount
	base.ToolGroups = append(base.ToolGroups, managed.ToolGroups...)
	if strings.TrimSpace(base.ExecutionState) == "" {
		base.ExecutionState = managed.ExecutionState
	}
	return base
}

func (s *Service) recordManagedMCPEgress(project *ProjectSession, req AIToolCallRequest, server AIMCPServerRecord, tool AIMCPManagedTool, arguments map[string]any, output any, callErr error, latency time.Duration) {
	if project == nil || project.Egress == nil {
		return
	}
	_, argumentRedaction := sanitizedManagedMCPJSON(arguments)
	_, outputRedaction := sanitizedManagedMCPJSON(output)
	redaction := mergeEgressRedactions([]AIEgressRecord{{Redaction: argumentRedaction}, {Redaction: outputRedaction}})
	requestID := "mcp-" + uuid.NewString()
	record := AIEgressRecord{
		ID:               "eg-" + requestID,
		RequestID:        requestID,
		ProviderID:       "managed-mcp:" + server.ID,
		ProviderKind:     "managed_mcp_" + string(server.Transport),
		Endpoint:         managedMCPEndpointOrigin(server.Endpoint),
		Model:            tool.Name,
		Capability:       providers.CapabilityToolCalling,
		ProjectPathHash:  hashProjectPath(project.ProjectRoot),
		ProjectSessionID: project.ID,
		DataCategories:   []string{"mcp_tool_arguments", "mcp_tool_result"},
		Redaction:        redaction,
		Status:           "completed",
		LatencyMs:        latency.Milliseconds(),
		OptInSource:      "user_per_egress_consent",
		CreatedAt:        utcNow(),
		RunID:            strings.TrimSpace(req.RunID),
		Source:           "managed_mcp",
	}
	if run, err := s.GetChatRun(project.ID, req.RunID); err == nil {
		record.ChatAction = run.Action
	}
	if callErr != nil {
		record.Status = "error"
		record.ErrorClass = errorClass(callErr)
		record.Canceled = ctxCanceledError(callErr)
	}
	if stored, err := project.Egress.Append(record); err == nil {
		record = stored
	}
	if record.RunID == "" || !s.runCanUseProject(project, record.RunID) {
		return
	}
	s.emitRunEvent(project, record.RunID, "ai:chat:egress-recorded", record)
	s.recordEgressTimeline(project, record.RunID, record)
	s.recordChatRunArtifact(project, record.RunID, AIChatRunArtifactEgress, "Managed MCP egress: "+server.ID+"/"+tool.Name+"/"+requestID, egressArtifactSummary(record), record)
}

func ctxCanceledError(err error) bool {
	return err != nil && (strings.Contains(strings.ToLower(err.Error()), "context canceled") || strings.Contains(strings.ToLower(err.Error()), "deadline exceeded"))
}

func managedMCPEndpointOrigin(endpoint string) string {
	parsed, err := url.Parse(strings.TrimSpace(endpoint))
	if err != nil || parsed == nil || parsed.Scheme == "" || parsed.Host == "" {
		return ""
	}
	return parsed.Scheme + "://" + parsed.Host
}

var managedMCPSecretKey = regexp.MustCompile(`(?i)(authorization|cookie|credential|password|secret|token|api[_-]?key)`)

func sanitizedManagedMCPJSON(value any) (string, AIRedactionSummary) {
	encoded, err := marshalManagedMCPJSON(value)
	if err != nil {
		text, redaction := sanitizeText(fmt.Sprint(value), AIRedactionSummary{})
		return truncateUTF8(sanitizedDisplayText(text), maxMCPToolOutputPreviewBytes), redaction
	}
	var decoded any
	if err := json.Unmarshal(encoded, &decoded); err == nil {
		var keyRedactions int
		decoded, keyRedactions = redactManagedMCPSecrets(decoded)
		encoded, _ = marshalManagedMCPJSON(decoded)
		text, redaction := sanitizeText(string(encoded), AIRedactionSummary{})
		redaction.SecretsRedacted += keyRedactions
		if keyRedactions > 0 {
			redaction.AppliedRules = appendUniqueString(redaction.AppliedRules, "managed-mcp-sensitive-key")
		}
		return truncateUTF8(sanitizedDisplayText(text), maxMCPToolOutputPreviewBytes), redaction
	}
	text, redaction := sanitizeText(string(encoded), AIRedactionSummary{})
	return truncateUTF8(sanitizedDisplayText(text), maxMCPToolOutputPreviewBytes), redaction
}

func marshalManagedMCPJSON(value any) ([]byte, error) {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		return nil, err
	}
	return bytes.TrimSpace(buffer.Bytes()), nil
}

func redactManagedMCPSecrets(value any) (any, int) {
	switch typed := value.(type) {
	case map[string]any:
		count := 0
		for key, child := range typed {
			if managedMCPSecretKey.MatchString(key) {
				typed[key] = "<redacted>"
				count++
				continue
			}
			var nested int
			typed[key], nested = redactManagedMCPSecrets(child)
			count += nested
		}
		return typed, count
	case []any:
		count := 0
		for index := range typed {
			var nested int
			typed[index], nested = redactManagedMCPSecrets(typed[index])
			count += nested
		}
		return typed, count
	default:
		return value, 0
	}
}

// ProposeManagedMCPFactForMnemonic accepts a fact the user has explicitly
// reviewed from a bounded MCP artifact. It never promotes raw MCP output: the
// normal Mnemonic approval flow still creates a second explicit confirmation.
func (s *Service) ProposeManagedMCPFactForMnemonic(projectID, runID, serverID, toolName, reviewedFact, reviewedBy string) (AIMnemonicWriteProposalResult, error) {
	project := s.project(normalizeProjectID(projectID))
	if project == nil || project.ManagedMCP == nil {
		return AIMnemonicWriteProposalResult{}, fmt.Errorf("AI project session is not open")
	}
	server, found, err := project.ManagedMCP.GetServer(serverID)
	if err != nil {
		return AIMnemonicWriteProposalResult{}, err
	}
	if !found {
		return AIMnemonicWriteProposalResult{}, fmt.Errorf("managed MCP server %q is not registered", strings.TrimSpace(serverID))
	}
	tool, found, err := project.ManagedMCP.GetTool(server.ID, toolName)
	if err != nil {
		return AIMnemonicWriteProposalResult{}, err
	}
	if !found {
		return AIMnemonicWriteProposalResult{}, fmt.Errorf("managed MCP tool %q is not discovered", strings.TrimSpace(toolName))
	}
	if !managedMCPResultWasRecorded(project, runID, server.ID, tool.Name) {
		return AIMnemonicWriteProposalResult{}, fmt.Errorf("reviewed MCP fact requires a completed managed MCP result for this run and tool")
	}
	reviewedFact, _ = sanitizedManagedMCPJSON(map[string]string{"fact": reviewedFact})
	var payload map[string]string
	if json.Unmarshal([]byte(reviewedFact), &payload) == nil {
		reviewedFact = payload["fact"]
	}
	reviewedFact = strings.TrimSpace(reviewedFact)
	if reviewedFact == "" {
		return AIMnemonicWriteProposalResult{}, fmt.Errorf("reviewed MCP fact is empty")
	}
	return s.ProposeMnemonicEntry(project.ID, AIMnemonicWriteProposalRequest{
		RunID: runID,
		Entry: AIMnemonicEntryInput{
			Type:       "mcp_reviewed_fact",
			Source:     "managed-mcp-review",
			Tags:       []string{"mcp", server.ID, tool.Name},
			Content:    reviewedFact,
			Importance: 5,
			IsLatest:   true,
			Provenance: map[string]string{
				"source":     "managed-mcp-reviewed-fact",
				"serverId":   server.ID,
				"tool":       tool.Name,
				"reviewedBy": firstNonEmpty(strings.TrimSpace(reviewedBy), "user"),
				"runId":      strings.TrimSpace(runID),
			},
		},
		Reason: "Reviewed managed MCP fact requires approval before Mnemonic promotion.",
	})
}

func managedMCPResultWasRecorded(project *ProjectSession, runID, serverID, toolName string) bool {
	if project == nil || project.Egress == nil || strings.TrimSpace(runID) == "" {
		return false
	}
	records, err := project.Egress.ListByRun(runID, 100)
	if err != nil {
		return false
	}
	for _, record := range records {
		if record.Source == "managed_mcp" && record.Status == "completed" && record.ProviderID == "managed-mcp:"+serverID && record.Model == toolName {
			return true
		}
	}
	return false
}
