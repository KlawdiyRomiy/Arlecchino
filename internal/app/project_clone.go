package app

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const cloneRepositoryTimeout = 15 * time.Minute

var cloneCredentialPattern = regexp.MustCompile(`(?i)([a-z][a-z0-9+.-]*://)[^/@\s]+@`)

func (a *App) CloneRepository(repositoryURL string, directory string, projectName string) (string, error) {
	repositoryURL = strings.TrimSpace(repositoryURL)
	directory = strings.TrimSpace(directory)
	projectName = strings.TrimSpace(projectName)

	if repositoryURL == "" {
		return "", fmt.Errorf("repository URL is required")
	}
	if directory == "" {
		return "", fmt.Errorf("destination directory is required")
	}
	if projectName == "" {
		projectName = deriveCloneProjectName(repositoryURL)
	}

	normalizedName, err := normalizeCloneProjectName(projectName)
	if err != nil {
		return "", err
	}

	destinationDir, err := filepath.Abs(directory)
	if err != nil {
		return "", fmt.Errorf("resolve destination directory: %w", err)
	}

	info, err := os.Stat(destinationDir)
	if err != nil {
		return "", fmt.Errorf("destination directory is not available: %w", err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("destination is not a directory: %s", destinationDir)
	}

	projectPath := filepath.Join(destinationDir, normalizedName)
	if err := ensureCloneTargetInsideDestination(destinationDir, projectPath); err != nil {
		return "", err
	}
	if _, err := os.Stat(projectPath); err == nil {
		return "", fmt.Errorf("project already exists: %s", projectPath)
	} else if !os.IsNotExist(err) {
		return "", fmt.Errorf("check clone target: %w", err)
	}

	ctx := a.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	cloneCtx, cancel := context.WithTimeout(ctx, cloneRepositoryTimeout)
	defer cancel()

	cmd := exec.CommandContext(cloneCtx, "git", "clone", "--", repositoryURL, projectPath)
	cmd.Dir = destinationDir
	output, err := cmd.CombinedOutput()
	if cloneCtx.Err() == context.DeadlineExceeded {
		return "", fmt.Errorf("git clone timed out")
	}
	if err != nil {
		message := sanitizeCloneOutput(string(output), repositoryURL)
		if message == "" {
			return "", fmt.Errorf("git clone failed: %w", err)
		}
		return "", fmt.Errorf("git clone failed: %s", message)
	}

	return projectPath, nil
}

func deriveCloneProjectName(repositoryURL string) string {
	candidate := strings.TrimSpace(repositoryURL)
	candidate = strings.TrimRight(candidate, "/")
	if before, _, found := strings.Cut(candidate, "?"); found {
		candidate = before
	}
	if before, _, found := strings.Cut(candidate, "#"); found {
		candidate = before
	}
	candidate = strings.TrimRight(candidate, "/")
	if candidate == "" {
		return ""
	}

	if parsed, err := url.Parse(candidate); err == nil && parsed.Path != "" {
		candidate = parsed.Path
	}

	if index := strings.LastIndexAny(candidate, "/:"); index >= 0 && index < len(candidate)-1 {
		candidate = candidate[index+1:]
	}
	candidate = strings.TrimSuffix(candidate, ".git")
	return strings.TrimSpace(candidate)
}

func normalizeCloneProjectName(projectName string) (string, error) {
	name := strings.TrimSpace(projectName)
	if name == "" {
		return "", fmt.Errorf("project name is required")
	}
	if name == "." || name == ".." {
		return "", fmt.Errorf("project name is invalid")
	}
	if strings.ContainsAny(name, `/\`) {
		return "", fmt.Errorf("project name must not contain path separators")
	}
	if strings.ContainsRune(name, '\x00') {
		return "", fmt.Errorf("project name is invalid")
	}
	return name, nil
}

func ensureCloneTargetInsideDestination(destinationDir string, projectPath string) error {
	relative, err := filepath.Rel(destinationDir, projectPath)
	if err != nil {
		return fmt.Errorf("resolve clone target: %w", err)
	}
	if relative == "." || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return fmt.Errorf("clone target escapes destination directory")
	}
	return nil
}

func sanitizeCloneOutput(output string, repositoryURL string) string {
	message := strings.TrimSpace(output)
	if message == "" {
		return ""
	}
	if repositoryURL != "" {
		message = strings.ReplaceAll(message, repositoryURL, "<repository>")
		if parsed, err := url.Parse(repositoryURL); err == nil && parsed.User != nil {
			redacted := *parsed
			redacted.User = url.User("<credentials>")
			message = strings.ReplaceAll(message, repositoryURL, redacted.String())
		}
	}
	message = cloneCredentialPattern.ReplaceAllString(message, "${1}<credentials>@")
	if len(message) > 2000 {
		message = message[:2000] + "..."
	}
	return message
}
