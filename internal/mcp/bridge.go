package mcp

import (
	"bufio"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	defaultBridgeDialTimeout  = 2 * time.Second
	defaultBridgeReadTimeout  = 8 * time.Second
	defaultBridgeWriteTimeout = 8 * time.Second
	defaultBridgeTokenTTL     = 1 * time.Hour
	defaultBridgeRotateTTL    = 30 * time.Minute
	metadataLockRetryDelay    = 25 * time.Millisecond
	metadataLockMaxAttempts   = 20
	envBridgeMetadataPath     = "ARLECCHINO_MCP_BRIDGE_METADATA_PATH"
)

type IDEBridge interface {
	Mode() string
	Available() bool
	Call(method string, params map[string]any) (any, error)
}

type ToolServiceOptions struct {
	Bridge                 IDEBridge
	EnableBridgeAutoDetect bool
	BridgeMetadataPath     string
	AuditLogPath           string
	AuditMemoryLimit       int
}

type BridgeCallHandler func(method string, params map[string]any) (any, error)

type IDEBridgeServer struct {
	handler      BridgeCallHandler
	metadataPath string
	token        string
	tokenExpires time.Time
	tokenTTL     time.Duration
	rotateTTL    time.Duration
	socketPath   string
	listener     net.Listener
	stopCh       chan struct{}
	started      bool
	mu           sync.Mutex
	wg           sync.WaitGroup
}

type bridgeMetadata struct {
	SocketPath string `json:"socketPath"`
	Token      string `json:"token"`
	PID        int    `json:"pid"`
	UpdatedAt  string `json:"updatedAt"`
	ExpiresAt  string `json:"expiresAt,omitempty"`
}

type bridgeRequest struct {
	Token  string         `json:"token"`
	Method string         `json:"method"`
	Params map[string]any `json:"params"`
}

type bridgeResponse struct {
	OK     bool   `json:"ok"`
	Result any    `json:"result,omitempty"`
	Error  string `json:"error,omitempty"`
}

type SocketIDEBridgeClient struct {
	metadataPath string
	dialTimeout  time.Duration
}

func DefaultBridgeMetadataPath() string {
	if override := strings.TrimSpace(os.Getenv(envBridgeMetadataPath)); override != "" {
		if filepath.IsAbs(override) {
			return override
		}

		configDir, err := os.UserConfigDir()
		if err == nil && strings.TrimSpace(configDir) != "" {
			return filepath.Join(configDir, "arlecchino", override)
		}

		absOverride, err := filepath.Abs(override)
		if err == nil {
			return absOverride
		}
		return override
	}

	configDir, err := os.UserConfigDir()
	if err != nil || strings.TrimSpace(configDir) == "" {
		return filepath.Join(os.TempDir(), "arlecchino-mcp-bridge.json")
	}
	return filepath.Join(configDir, "arlecchino", "mcp-bridge.json")
}

func NewSocketIDEBridgeClient(metadataPath string) *SocketIDEBridgeClient {
	trimmed := strings.TrimSpace(metadataPath)
	if trimmed == "" {
		trimmed = DefaultBridgeMetadataPath()
	}

	return &SocketIDEBridgeClient{
		metadataPath: trimmed,
		dialTimeout:  defaultBridgeDialTimeout,
	}
}

func (c *SocketIDEBridgeClient) Mode() string {
	return "socket"
}

func (c *SocketIDEBridgeClient) Available() bool {
	metadata, err := c.readMetadata()
	if err != nil {
		return false
	}

	if strings.TrimSpace(metadata.SocketPath) == "" || strings.TrimSpace(metadata.Token) == "" {
		return false
	}

	if _, err := os.Stat(metadata.SocketPath); err != nil {
		return false
	}

	return true
}

func (c *SocketIDEBridgeClient) Call(method string, params map[string]any) (any, error) {
	metadata, err := c.readMetadata()
	if err != nil {
		return nil, err
	}

	if strings.TrimSpace(method) == "" {
		return nil, fmt.Errorf("bridge method is empty")
	}

	connection, err := net.DialTimeout("unix", metadata.SocketPath, c.dialTimeout)
	if err != nil {
		return nil, fmt.Errorf("bridge unavailable: %w", err)
	}
	defer connection.Close()

	if err := connection.SetWriteDeadline(time.Now().Add(defaultBridgeWriteTimeout)); err != nil {
		return nil, err
	}

	request := bridgeRequest{
		Token:  metadata.Token,
		Method: method,
		Params: params,
	}
	if request.Params == nil {
		request.Params = map[string]any{}
	}

	encoder := json.NewEncoder(connection)
	if err := encoder.Encode(request); err != nil {
		return nil, err
	}

	if err := connection.SetReadDeadline(time.Now().Add(defaultBridgeReadTimeout)); err != nil {
		return nil, err
	}

	var response bridgeResponse
	decoder := json.NewDecoder(bufio.NewReader(connection))
	if err := decoder.Decode(&response); err != nil {
		return nil, err
	}

	if !response.OK {
		if strings.TrimSpace(response.Error) == "" {
			return nil, fmt.Errorf("bridge call failed")
		}
		return nil, fmt.Errorf(response.Error)
	}

	return response.Result, nil
}

func (c *SocketIDEBridgeClient) readMetadata() (bridgeMetadata, error) {
	data, err := os.ReadFile(c.metadataPath)
	if err != nil {
		return bridgeMetadata{}, err
	}

	var metadata bridgeMetadata
	if err := json.Unmarshal(data, &metadata); err != nil {
		return bridgeMetadata{}, err
	}

	return metadata, nil
}

func NewIDEBridgeServer(handler BridgeCallHandler) (*IDEBridgeServer, error) {
	return NewIDEBridgeServerWithMetadataPath(handler, "")
}

func NewIDEBridgeServerWithMetadataPath(handler BridgeCallHandler, metadataPath string) (*IDEBridgeServer, error) {
	if handler == nil {
		return nil, fmt.Errorf("bridge handler is nil")
	}

	token, err := randomToken(32)
	if err != nil {
		return nil, err
	}

	resolvedMetadataPath := strings.TrimSpace(metadataPath)
	if resolvedMetadataPath == "" {
		resolvedMetadataPath = DefaultBridgeMetadataPath()
	}

	return &IDEBridgeServer{
		handler:      handler,
		metadataPath: resolvedMetadataPath,
		token:        token,
		tokenTTL:     defaultBridgeTokenTTL,
		rotateTTL:    defaultBridgeRotateTTL,
	}, nil
}

func (s *IDEBridgeServer) Start() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.started {
		return nil
	}

	if s.tokenTTL <= 0 {
		s.tokenTTL = defaultBridgeTokenTTL
	}
	if s.rotateTTL <= 0 {
		s.rotateTTL = defaultBridgeRotateTTL
	}
	s.tokenExpires = time.Now().UTC().Add(s.tokenTTL)

	cacheDir, err := os.UserCacheDir()
	if err != nil || strings.TrimSpace(cacheDir) == "" {
		cacheDir = os.TempDir()
	}

	socketDir := filepath.Join(cacheDir, "arlecchino")
	if err := os.MkdirAll(socketDir, 0o700); err != nil {
		return err
	}

	socketPath := filepath.Join(socketDir, fmt.Sprintf("mcp-bridge-%d-%d.sock", os.Getpid(), time.Now().UnixNano()))
	_ = os.Remove(socketPath)

	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		return err
	}

	if err := os.Chmod(socketPath, 0o600); err != nil {
		_ = listener.Close()
		return err
	}

	if err := s.writeMetadata(socketPath); err != nil {
		_ = listener.Close()
		_ = os.Remove(socketPath)
		return err
	}

	s.listener = listener
	s.socketPath = socketPath
	s.stopCh = make(chan struct{})
	s.started = true

	s.wg.Add(1)
	go s.acceptLoop()

	s.wg.Add(1)
	go s.tokenRotationLoop()

	return nil
}

func (s *IDEBridgeServer) Stop() error {
	s.mu.Lock()
	if !s.started {
		s.mu.Unlock()
		return nil
	}

	listener := s.listener
	socketPath := s.socketPath
	stopCh := s.stopCh
	s.started = false
	s.listener = nil
	s.socketPath = ""
	s.mu.Unlock()

	if stopCh != nil {
		close(stopCh)
	}

	if listener != nil {
		_ = listener.Close()
	}

	s.wg.Wait()

	if strings.TrimSpace(socketPath) != "" {
		_ = os.Remove(socketPath)
	}

	s.mu.Lock()
	s.stopCh = nil
	s.mu.Unlock()

	_ = s.removeMetadataIfOwned()
	return nil
}

func (s *IDEBridgeServer) tokenRotationLoop() {
	defer s.wg.Done()

	s.mu.Lock()
	stopCh := s.stopCh
	rotateTTL := s.rotateTTL
	s.mu.Unlock()

	if stopCh == nil {
		return
	}

	ticker := time.NewTicker(rotateTTL)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			s.mu.Lock()
			if !s.started {
				s.mu.Unlock()
				return
			}

			newToken, err := randomToken(32)
			if err == nil {
				s.token = newToken
				s.tokenExpires = time.Now().UTC().Add(s.tokenTTL)
				_ = s.writeMetadata(s.socketPath)
			}

			s.mu.Unlock()
		case <-stopCh:
			return
		}
	}
}

func (s *IDEBridgeServer) SocketPath() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.socketPath
}

func (s *IDEBridgeServer) acceptLoop() {
	defer s.wg.Done()

	for {
		s.mu.Lock()
		listener := s.listener
		started := s.started
		s.mu.Unlock()

		if !started || listener == nil {
			return
		}

		connection, err := listener.Accept()
		if err != nil {
			s.mu.Lock()
			stillStarted := s.started
			s.mu.Unlock()
			if !stillStarted {
				return
			}
			continue
		}

		s.wg.Add(1)
		go s.handleConnection(connection)
	}
}

func (s *IDEBridgeServer) handleConnection(connection net.Conn) {
	defer s.wg.Done()
	defer connection.Close()

	_ = connection.SetReadDeadline(time.Now().Add(defaultBridgeReadTimeout))

	var request bridgeRequest
	decoder := json.NewDecoder(bufio.NewReader(connection))
	if err := decoder.Decode(&request); err != nil {
		s.writeBridgeResponse(connection, bridgeResponse{OK: false, Error: err.Error()})
		return
	}

	s.mu.Lock()
	currentToken := strings.TrimSpace(s.token)
	tokenExpired := !s.tokenExpires.IsZero() && time.Now().UTC().After(s.tokenExpires)
	s.mu.Unlock()

	if tokenExpired {
		s.writeBridgeResponse(connection, bridgeResponse{OK: false, Error: "bridge token expired"})
		return
	}

	if subtle.ConstantTimeCompare([]byte(strings.TrimSpace(request.Token)), []byte(currentToken)) != 1 {
		s.writeBridgeResponse(connection, bridgeResponse{OK: false, Error: "unauthorized bridge token"})
		return
	}

	if strings.TrimSpace(request.Method) == "" {
		s.writeBridgeResponse(connection, bridgeResponse{OK: false, Error: "bridge method is empty"})
		return
	}

	if request.Params == nil {
		request.Params = map[string]any{}
	}

	result, err := s.handler(request.Method, request.Params)
	if err != nil {
		s.writeBridgeResponse(connection, bridgeResponse{OK: false, Error: err.Error()})
		return
	}

	s.writeBridgeResponse(connection, bridgeResponse{OK: true, Result: result})
}

func (s *IDEBridgeServer) writeBridgeResponse(connection net.Conn, response bridgeResponse) {
	_ = connection.SetWriteDeadline(time.Now().Add(defaultBridgeWriteTimeout))
	encoder := json.NewEncoder(connection)
	_ = encoder.Encode(response)
}

func (s *IDEBridgeServer) writeMetadata(socketPath string) error {
	metadata := bridgeMetadata{
		SocketPath: socketPath,
		Token:      s.token,
		PID:        os.Getpid(),
		UpdatedAt:  time.Now().UTC().Format(time.RFC3339),
		ExpiresAt:  s.tokenExpires.UTC().Format(time.RFC3339),
	}

	data, err := json.Marshal(metadata)
	if err != nil {
		return err
	}

	metadataDir := filepath.Dir(s.metadataPath)
	if err := os.MkdirAll(metadataDir, 0o700); err != nil {
		return err
	}

	lockPath := s.metadataPath + ".lock"
	var lockFile *os.File
	for attempt := 0; attempt < metadataLockMaxAttempts; attempt++ {
		lockFile, err = os.OpenFile(lockPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err == nil {
			break
		}
		if os.IsExist(err) {
			time.Sleep(metadataLockRetryDelay)
			continue
		}
		return err
	}
	if lockFile == nil {
		return fmt.Errorf("bridge metadata lock is busy")
	}
	_ = lockFile.Close()
	defer os.Remove(lockPath)

	tempPath := s.metadataPath + ".tmp"
	if err := os.WriteFile(tempPath, data, 0o600); err != nil {
		return err
	}

	if err := os.Rename(tempPath, s.metadataPath); err != nil {
		_ = os.Remove(tempPath)
		return err
	}

	return nil
}

func (s *IDEBridgeServer) removeMetadataIfOwned() error {
	data, err := os.ReadFile(s.metadataPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	var metadata bridgeMetadata
	if err := json.Unmarshal(data, &metadata); err != nil {
		return nil
	}

	if subtle.ConstantTimeCompare([]byte(strings.TrimSpace(metadata.Token)), []byte(strings.TrimSpace(s.token))) != 1 {
		return nil
	}

	return os.Remove(s.metadataPath)
}

func randomToken(byteLen int) (string, error) {
	if byteLen <= 0 {
		byteLen = 32
	}

	tokenBytes := make([]byte, byteLen)
	if _, err := rand.Read(tokenBytes); err != nil {
		return "", err
	}

	return hex.EncodeToString(tokenBytes), nil
}
