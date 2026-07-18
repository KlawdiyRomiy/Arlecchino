package ai

import (
	"context"
	"fmt"
	"net/url"
	"strings"
)

func (s *Service) executeBrowserPreviewTool(ctx context.Context, project *ProjectSession, req AIToolCallRequest, result AIToolCallResult) AIToolCallResult {
	url := strings.TrimSpace(req.Arguments["url"])
	if !browserPreviewURLAllowed(url) {
		result.Status = "blocked"
		result.Error = "browser preview accepts loopback http(s) URLs only"
		return result
	}
	if req.Action != AIToolCallActionExecute {
		result.Status = "previewed"
		result.OutputPreview = url
		return result
	}
	if s == nil || s.browserPreview == nil {
		result.Status = "blocked"
		result.Error = "browser preview bridge is not available"
		return result
	}
	preview, err := s.browserPreview(ctx, project.ProjectRoot, AIBrowserPreviewRequest{URL: url, Title: req.Arguments["title"]})
	if err != nil {
		result.Status = "error"
		result.Error = sanitizedDisplayText(err.Error())
		return result
	}
	result.Status = "executed"
	result.OutputPreview = sanitizedDisplayText(firstNonEmpty(preview.Summary, fmt.Sprintf("Browser preview opened for %s", url)))
	if strings.TrimSpace(req.RunID) != "" {
		title := "Browser preview evidence"
		if preview.ScreenshotCaptured {
			title = "Browser preview screenshot evidence"
		}
		s.recordChatRunArtifact(project, req.RunID, AIChatRunArtifactBrowser, title, result.OutputPreview, preview)
		result.ArtifactID = "artifact-" + shortHash(req.RunID+":"+string(AIChatRunArtifactBrowser)+":"+title)
	}
	return result
}

func browserPreviewURLAllowed(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed == nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil {
		return false
	}
	return isLoopbackEndpoint(value)
}
