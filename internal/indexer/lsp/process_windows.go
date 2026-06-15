//go:build windows

package lsp

import (
	"os"
	"os/exec"
	"time"
)

func configureLSPProcessGroup(_ *exec.Cmd) {}

func applyLSPProcessPriority(_ *exec.Cmd) lspProcessPriorityResult {
	policy := currentLSPProcessPriorityPolicy()
	return lspProcessPriorityResult{
		Policy: policy,
		Target: "process",
		Status: "unsupported",
	}
}

func terminateLSPProcess(process *os.Process, _ time.Duration) {
	if process != nil {
		_ = process.Kill()
	}
}
