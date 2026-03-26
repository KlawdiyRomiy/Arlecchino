package laravel

import (
	"bufio"
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
	"time"
)

//go:embed bridge/bridge.php
var bridgePHPContent string

type Request struct {
	ID     interface{}            `json:"id"`
	Action string                 `json:"action"`
	Params map[string]interface{} `json:"params"`
}

type Response struct {
	ID      interface{} `json:"id"`
	Result  interface{} `json:"result"`
	Error   *string     `json:"error"`
	Success bool        `json:"success"`
}

type PHPBridge struct {
	ProjectPath    string
	cmd            *exec.Cmd
	stdin          io.WriteCloser
	stdout         io.Reader
	scanner        *bufio.Scanner
	ctx            context.Context
	cancel         context.CancelFunc
	mu             sync.Mutex
	requestID      int
	tmpFilePath    string
	requestTimeout time.Duration
}

func NewPHPBridge(projectPath string) (*PHPBridge, error) {
	tmpFile, err := os.CreateTemp("", "bridge-*.php")
	if err != nil {
		return nil, fmt.Errorf("failed to create temp file: %w", err)
	}

	if _, err := tmpFile.WriteString(bridgePHPContent); err != nil {
		tmpFile.Close()
		os.Remove(tmpFile.Name())
		return nil, fmt.Errorf("failed to write bridge content: %w", err)
	}
	tmpFile.Close()

	bridgePath := tmpFile.Name()

	ctx, cancel := context.WithCancel(context.Background())
	cmd := exec.CommandContext(ctx, "php", bridgePath, projectPath)
	cmd.Dir = projectPath

	stdin, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		return nil, fmt.Errorf("failed to create stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return nil, fmt.Errorf("failed to create stdout pipe: %w", err)
	}
	if err := cmd.Start(); err != nil {
		cancel()
		return nil, fmt.Errorf("failed to start PHP bridge: %w", err)
	}

	scanner := bufio.NewScanner(stdout)

	bridge := &PHPBridge{
		ProjectPath:    projectPath,
		cmd:            cmd,
		stdin:          stdin,
		stdout:         stdout,
		scanner:        scanner,
		ctx:            ctx,
		cancel:         cancel,
		requestID:      1,
		tmpFilePath:    bridgePath,
		requestTimeout: 60 * time.Second,
	}

	return bridge, nil
}

func (b *PHPBridge) Call(action string, params map[string]interface{}) (interface{}, error) {
	b.mu.Lock()
	defer b.mu.Unlock()

	requestID := b.requestID
	b.requestID++

	if b.cmd == nil || b.cmd.ProcessState != nil {
		return nil, fmt.Errorf("bridge is not running")
	}

	request := Request{
		ID:     requestID,
		Action: action,
		Params: params,
	}

	requestJSON, err := json.Marshal(request)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	_, err = b.stdin.Write(append(requestJSON, '\n'))
	if err != nil {
		return nil, fmt.Errorf("failed to write request to stdin: %w", err)
	}

	ctx := b.ctx
	var cancel context.CancelFunc
	if b.requestTimeout > 0 {
		ctx, cancel = context.WithTimeout(ctx, b.requestTimeout)
		defer cancel()
	}

	responseCh := make(chan string, 1)
	errCh := make(chan error, 1)

	go func() {
		if !b.scanner.Scan() {
			err := b.scanner.Err()
			if err != nil {
				errCh <- err
				return
			}
			errCh <- io.EOF
			return
		}
		responseCh <- b.scanner.Text()
	}()

	var responseJSON string
	select {
	case <-ctx.Done():
		return nil, fmt.Errorf("bridge timeout: %w", ctx.Err())
	case err := <-errCh:
		return nil, fmt.Errorf("failed to read response: %w", err)
	case responseJSON = <-responseCh:
	}

	var response Response
	if err := json.Unmarshal([]byte(responseJSON), &response); err != nil {
		return nil, fmt.Errorf("failed to unmarshal response: %w (response: %s)", err, responseJSON)
	}

	var responseIDInt int
	switch v := response.ID.(type) {
	case float64:
		responseIDInt = int(v)
	case int:
		responseIDInt = v
	default:
		return nil, fmt.Errorf("unexpected response ID type: %T", response.ID)
	}

	if responseIDInt != requestID {
		return nil, fmt.Errorf("response ID mismatch: expected %d, got %d", requestID, responseIDInt)
	}

	if !response.Success {
		errMsg := ""
		if response.Error != nil {
			errMsg = *response.Error
		}
		return nil, fmt.Errorf("bridge error: %s", errMsg)
	}

	return response.Result, nil
}

func (b *PHPBridge) SetRequestTimeout(timeout time.Duration) {
	b.mu.Lock()
	b.requestTimeout = timeout
	b.mu.Unlock()
}

func (b *PHPBridge) IsRunning() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.cmd != nil && b.cmd.Process != nil && b.cmd.ProcessState == nil
}

func (b *PHPBridge) Restart() error {
	b.mu.Lock()
	projectPath := b.ProjectPath
	b.mu.Unlock()

	b.Close()

	newBridge, err := NewPHPBridge(projectPath)
	if err != nil {
		return err
	}

	b.mu.Lock()
	b.ProjectPath = newBridge.ProjectPath
	b.cmd = newBridge.cmd
	b.stdin = newBridge.stdin
	b.stdout = newBridge.stdout
	b.scanner = newBridge.scanner
	b.ctx = newBridge.ctx
	b.cancel = newBridge.cancel
	b.requestID = newBridge.requestID
	b.tmpFilePath = newBridge.tmpFilePath
	b.requestTimeout = newBridge.requestTimeout
	b.mu.Unlock()
	return nil
}

func (b *PHPBridge) Close() error {
	if b.cancel != nil {
		b.cancel()
	}

	b.mu.Lock()
	stdin := b.stdin
	b.stdin = nil
	b.mu.Unlock()

	if stdin != nil {
		stdin.Close()
	}

	b.mu.Lock()
	defer b.mu.Unlock()

	if b.cmd != nil {
		done := make(chan error, 1)
		go func() {
			done <- b.cmd.Wait()
		}()

		select {
		case <-time.After(2 * time.Second):
			if b.cmd.Process != nil {
				b.cmd.Process.Kill()
			}
		case <-done:
		}
	}

	if b.tmpFilePath != "" {
		os.Remove(b.tmpFilePath)
	}

	return nil
}

func (b *PHPBridge) GetMiddlewareList() (interface{}, error) {
	result, err := b.Call("middleware.list", map[string]interface{}{})
	if err != nil {
		return nil, fmt.Errorf("failed to get middleware list: %w", err)
	}

	return result, nil
}

func (b *PHPBridge) GetRouteList(filter string) (interface{}, error) {
	params := map[string]interface{}{}
	if filter != "" {
		params["filter"] = filter
	}

	result, err := b.Call("route.list", params)
	if err != nil {
		return nil, fmt.Errorf("failed to get route list: %w", err)
	}

	return result, nil
}

func (b *PHPBridge) AnalyzeModels(modelName string) (interface{}, error) {
	params := map[string]interface{}{}
	if modelName != "" {
		params["model"] = modelName
	}

	result, err := b.Call("model.analyze", params)
	if err != nil {
		return nil, fmt.Errorf("failed to analyze models: %w", err)
	}

	return result, nil
}

func (b *PHPBridge) ExecuteQuery(query string, bindings []interface{}) (interface{}, error) {
	params := map[string]interface{}{
		"query":    query,
		"bindings": bindings,
	}

	result, err := b.Call("query.execute", params)
	if err != nil {
		return nil, fmt.Errorf("failed to execute query: %w", err)
	}

	return result, nil
}
