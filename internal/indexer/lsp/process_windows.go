//go:build windows

package lsp

import (
	"os"
	"os/exec"
	"time"
)

func configureLSPProcessGroup(_ *exec.Cmd) {}

func terminateLSPProcess(process *os.Process, _ time.Duration) {
	if process != nil {
		_ = process.Kill()
	}
}
