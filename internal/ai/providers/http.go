package providers

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const maxProviderResponseBytes = 4 << 20

func normalizeEndpoint(endpoint string, fallback string) string {
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		endpoint = fallback
	}
	return strings.TrimRight(endpoint, "/")
}

func newHTTPClient(timeout time.Duration) *http.Client {
	if timeout <= 0 {
		timeout = 3 * time.Second
	}
	return &http.Client{
		Timeout:       timeout,
		CheckRedirect: sameOriginRedirectPolicy,
	}
}

func sameOriginRedirectPolicy(req *http.Request, via []*http.Request) error {
	if len(via) == 0 {
		return nil
	}
	if len(via) >= 10 {
		return fmt.Errorf("provider redirect limit exceeded")
	}
	previous := via[len(via)-1]
	if previous == nil || previous.URL == nil || req == nil || req.URL == nil {
		return fmt.Errorf("provider redirect blocked")
	}
	if strings.EqualFold(req.URL.Scheme, previous.URL.Scheme) && strings.EqualFold(req.URL.Host, previous.URL.Host) {
		return nil
	}
	return fmt.Errorf("provider redirect blocked: cross-origin redirect from %s://%s to %s://%s", previous.URL.Scheme, previous.URL.Host, req.URL.Scheme, req.URL.Host)
}

func decodeJSONResponse(resp *http.Response, target any) error {
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		limited, _ := io.ReadAll(io.LimitReader(resp.Body, 16<<10))
		return fmt.Errorf("provider returned HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(limited)))
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxProviderResponseBytes+1))
	if err != nil {
		return err
	}
	if len(data) > maxProviderResponseBytes {
		return fmt.Errorf("provider response exceeds %d bytes", maxProviderResponseBytes)
	}
	if len(data) == 0 {
		return nil
	}
	return json.Unmarshal(data, target)
}

func postJSON(ctx context.Context, client *http.Client, endpoint string, headers map[string]string, body any, target any) (int, error) {
	resp, err := postJSONRaw(ctx, client, endpoint, headers, body)
	if err != nil {
		return 0, err
	}
	status := resp.StatusCode
	return status, decodeJSONResponse(resp, target)
}

func postJSONRaw(ctx context.Context, client *http.Client, endpoint string, headers map[string]string, body any) (*http.Response, error) {
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	for key, value := range headers {
		if strings.TrimSpace(value) != "" {
			req.Header.Set(key, value)
		}
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	return resp, nil
}

func getJSON(ctx context.Context, client *http.Client, endpoint string, headers map[string]string, target any) (int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return 0, err
	}
	for key, value := range headers {
		if strings.TrimSpace(value) != "" {
			req.Header.Set(key, value)
		}
	}
	resp, err := client.Do(req)
	if err != nil {
		return 0, err
	}
	status := resp.StatusCode
	return status, decodeJSONResponse(resp, target)
}

func scanServerSentEvents(body io.Reader, handle func(string, []byte) error) error {
	if body == nil || handle == nil {
		return nil
	}
	scanner := bufio.NewScanner(body)
	scanner.Buffer(make([]byte, 0, 4096), maxProviderResponseBytes)
	var eventName string
	dataLines := []string{}
	totalBytes := 0
	dispatch := func() error {
		if len(dataLines) == 0 {
			eventName = ""
			return nil
		}
		data := []byte(strings.Join(dataLines, "\n"))
		dataLines = dataLines[:0]
		name := eventName
		eventName = ""
		return handle(name, data)
	}
	for scanner.Scan() {
		line := strings.TrimSuffix(scanner.Text(), "\r")
		totalBytes += len(line) + 1
		if totalBytes > maxProviderResponseBytes {
			return fmt.Errorf("provider response exceeds %d bytes", maxProviderResponseBytes)
		}
		if line == "" {
			if err := dispatch(); err != nil {
				return err
			}
			continue
		}
		if strings.HasPrefix(line, ":") {
			continue
		}
		field, value, found := strings.Cut(line, ":")
		if !found {
			field = line
			value = ""
		}
		value = strings.TrimPrefix(value, " ")
		switch field {
		case "event":
			eventName = value
		case "data":
			dataLines = append(dataLines, value)
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	return dispatch()
}

func validateToolArgumentsJSONObject(toolName string, argumentsJSON string) error {
	argumentsJSON = strings.TrimSpace(argumentsJSON)
	if argumentsJSON == "" {
		argumentsJSON = "{}"
	}
	var arguments map[string]any
	if err := json.Unmarshal([]byte(argumentsJSON), &arguments); err != nil {
		return fmt.Errorf("tool %s returned invalid JSON arguments: %w", firstNonEmptyString(toolName, "call"), err)
	}
	if arguments == nil {
		return fmt.Errorf("tool %s returned non-object JSON arguments", firstNonEmptyString(toolName, "call"))
	}
	return nil
}

func validateGenerationToolCalls(calls []GenerationToolCall) error {
	for index, call := range calls {
		name := strings.TrimSpace(call.Name)
		if name == "" {
			return fmt.Errorf("tool call %d is missing a name", index)
		}
		if err := validateToolArgumentsJSONObject(name, call.ArgumentsJSON); err != nil {
			return err
		}
	}
	return nil
}
