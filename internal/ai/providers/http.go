package providers

import (
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
	return &http.Client{Timeout: timeout}
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
