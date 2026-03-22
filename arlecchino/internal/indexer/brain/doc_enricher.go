package brain

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

type DocEnricher struct {
	mu             sync.RWMutex
	localExtractor *LocalDocExtractor
	cache          *DocCache
	context7       *Context7Client
	github         *GitHubDocClient
	projectRoot    string
	timeout        time.Duration
}

type Context7Client struct {
	httpClient *http.Client
	baseURL    string
}

type GitHubDocClient struct {
	httpClient *http.Client
	token      string
}

func NewDocEnricher(projectRoot string) *DocEnricher {
	return &DocEnricher{
		localExtractor: NewLocalDocExtractor(),
		cache:          NewDocCache(""),
		context7:       NewContext7Client(),
		github:         NewGitHubDocClient(""),
		projectRoot:    projectRoot,
		timeout:        5 * time.Second,
	}
}

func NewContext7Client() *Context7Client {
	return &Context7Client{
		httpClient: &http.Client{Timeout: 10 * time.Second},
		baseURL:    "https://context7.com/api/v1",
	}
}

func NewGitHubDocClient(token string) *GitHubDocClient {
	return &GitHubDocClient{
		httpClient: &http.Client{Timeout: 10 * time.Second},
		token:      token,
	}
}

func (e *DocEnricher) SetGitHubToken(token string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.github.token = token
}

func (e *DocEnricher) GetDocumentation(packageName, symbolName, version, language string) *DocEntry {
	if cached := e.cache.Get(packageName, symbolName, version); cached != nil {
		return cached
	}

	if entry := e.tryLocalDocs(packageName, symbolName, language); entry != nil {
		e.cache.Set(packageName, symbolName, version, entry)
		return entry
	}

	ctx, cancel := context.WithTimeout(context.Background(), e.timeout)
	defer cancel()

	if entry := e.tryContext7(ctx, packageName, symbolName, version); entry != nil {
		e.cache.Set(packageName, symbolName, version, entry)
		return entry
	}

	if entry := e.tryGitHub(ctx, packageName, symbolName); entry != nil {
		e.cache.Set(packageName, symbolName, version, entry)
		return entry
	}

	return nil
}

func (e *DocEnricher) tryLocalDocs(packageName, symbolName, language string) *DocEntry {
	switch language {
	case "typescript", "javascript":
		if dtsPath := e.localExtractor.FindDTSFile(packageName, e.projectRoot); dtsPath != "" {
			return e.localExtractor.ExtractFromDTS(dtsPath, symbolName)
		}
	case "python":
		if pyiPath := e.localExtractor.FindPYIFile(packageName, e.projectRoot); pyiPath != "" {
			return e.localExtractor.ExtractFromPYI(pyiPath, symbolName)
		}
	}
	return nil
}

func (e *DocEnricher) tryContext7(ctx context.Context, packageName, symbolName, version string) *DocEntry {
	if e.context7 == nil {
		return nil
	}
	return e.context7.FetchDocumentation(ctx, packageName, symbolName, version)
}

func (e *DocEnricher) tryGitHub(ctx context.Context, packageName, symbolName string) *DocEntry {
	if e.github == nil {
		return nil
	}
	return e.github.SearchExamples(ctx, packageName, symbolName)
}

func (c *Context7Client) FetchDocumentation(ctx context.Context, packageName, symbolName, version string) *DocEntry {
	endpoint := fmt.Sprintf("%s/docs/%s/%s", c.baseURL, url.PathEscape(packageName), url.PathEscape(symbolName))
	if version != "" {
		endpoint += "?version=" + url.QueryEscape(version)
	}

	req, err := http.NewRequestWithContext(ctx, "GET", endpoint, nil)
	if err != nil {
		return nil
	}
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil
	}

	var result struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Signature   string `json:"signature"`
		Parameters  []struct {
			Name        string `json:"name"`
			Type        string `json:"type"`
			Description string `json:"description"`
			Optional    bool   `json:"optional"`
		} `json:"parameters"`
		Returns  string   `json:"returns"`
		Examples []string `json:"examples"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil
	}

	entry := &DocEntry{
		Symbol:      result.Name,
		Package:     packageName,
		Description: result.Description,
		Signature:   result.Signature,
		Returns:     result.Returns,
		Examples:    result.Examples,
		Source:      DocSourceContext7,
		FetchedAt:   time.Now(),
	}

	for _, p := range result.Parameters {
		entry.Parameters = append(entry.Parameters, ParamDoc{
			Name:        p.Name,
			Type:        p.Type,
			Description: p.Description,
			Optional:    p.Optional,
		})
	}

	return entry
}

func (g *GitHubDocClient) SearchExamples(ctx context.Context, packageName, symbolName string) *DocEntry {
	query := fmt.Sprintf("%s %s language:go language:typescript language:python", packageName, symbolName)
	endpoint := fmt.Sprintf("https://api.github.com/search/code?q=%s&per_page=5", url.QueryEscape(query))

	req, err := http.NewRequestWithContext(ctx, "GET", endpoint, nil)
	if err != nil {
		return nil
	}
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	if g.token != "" {
		req.Header.Set("Authorization", "token "+g.token)
	}

	resp, err := g.httpClient.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil
	}

	var result struct {
		Items []struct {
			Name       string `json:"name"`
			Path       string `json:"path"`
			Repository struct {
				FullName string `json:"full_name"`
			} `json:"repository"`
			HTMLURL string `json:"html_url"`
		} `json:"items"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil
	}

	if len(result.Items) == 0 {
		return nil
	}

	var examples []string
	for _, item := range result.Items {
		examples = append(examples, fmt.Sprintf("// %s\n// %s", item.Repository.FullName, item.HTMLURL))
	}

	return &DocEntry{
		Symbol:      symbolName,
		Package:     packageName,
		Description: fmt.Sprintf("Found %d usage examples in GitHub", len(result.Items)),
		Examples:    examples,
		Source:      DocSourceGitHub,
		FetchedAt:   time.Now(),
	}
}

func (e *DocEnricher) EnrichSuggestion(s *Suggestion, language string) {
	if s.Documentation != "" {
		return
	}

	packageName := e.extractPackageName(s.Namespace, s.FilePath, language)
	if packageName == "" {
		return
	}

	entry := e.GetDocumentation(packageName, s.Text, "", language)
	if entry == nil {
		return
	}

	s.Documentation = entry.Description
	if entry.Signature != "" && s.Detail == "" {
		s.Detail = entry.Signature
	}
}

func (e *DocEnricher) extractPackageName(namespace, filePath, language string) string {
	if namespace != "" {
		parts := strings.Split(namespace, "/")
		if len(parts) > 0 {
			return parts[0]
		}
		parts = strings.Split(namespace, "\\")
		if len(parts) > 0 {
			return parts[0]
		}
	}

	if strings.Contains(filePath, "node_modules/") {
		idx := strings.Index(filePath, "node_modules/")
		rest := filePath[idx+13:]
		parts := strings.Split(rest, "/")
		if len(parts) > 0 {
			if strings.HasPrefix(parts[0], "@") && len(parts) > 1 {
				return parts[0] + "/" + parts[1]
			}
			return parts[0]
		}
	}

	if strings.Contains(filePath, "site-packages/") {
		idx := strings.Index(filePath, "site-packages/")
		rest := filePath[idx+14:]
		parts := strings.Split(rest, "/")
		if len(parts) > 0 {
			return parts[0]
		}
	}

	return ""
}

func (e *DocEnricher) ClearCache() {
	e.cache.Clear()
	e.localExtractor.ClearCache()
}

func (e *DocEnricher) CleanupExpired() {
	e.cache.CleanupExpired()
	e.localExtractor.CleanupExpired()
}
