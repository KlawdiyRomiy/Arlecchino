//go:build !windows

package lsp

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

func lspProcessRSSBytes(pid int) (int64, error) {
	if pid <= 0 {
		return 0, fmt.Errorf("invalid pid: %d", pid)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, "ps", "-o", "rss=", "-p", strconv.Itoa(pid))
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	output, err := cmd.Output()
	if err != nil {
		message := strings.TrimSpace(stderr.String())
		if message == "" {
			message = err.Error()
		}
		return 0, fmt.Errorf("read rss for pid %d: %s", pid, message)
	}
	value := strings.TrimSpace(string(output))
	if value == "" {
		return 0, fmt.Errorf("rss unavailable for pid %d", pid)
	}
	kb, err := strconv.ParseInt(strings.Fields(value)[0], 10, 64)
	if err != nil {
		return 0, fmt.Errorf("parse rss for pid %d: %w", pid, err)
	}
	return kb * 1024, nil
}
