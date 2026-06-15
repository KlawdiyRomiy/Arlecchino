//go:build !windows

package lsp

import (
	"os"
	"os/exec"
	"syscall"
	"time"
)

func configureLSPProcessGroup(cmd *exec.Cmd) {
	if cmd != nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	}
}

func applyLSPProcessPriority(cmd *exec.Cmd) lspProcessPriorityResult {
	policy := currentLSPProcessPriorityPolicy()
	result := lspProcessPriorityResult{
		Policy: policy,
		Target: "process_group",
		Status: "disabled",
	}
	if !policy.Enabled {
		return result
	}
	if cmd == nil || cmd.Process == nil || cmd.Process.Pid <= 0 {
		result.Status = "skipped"
		return result
	}

	pid := cmd.Process.Pid
	if err := syscall.Setpriority(syscall.PRIO_PGRP, pid, policy.Nice); err == nil {
		result.Status = "applied"
		return result
	} else {
		result.Err = err
	}

	result.Target = "process"
	if err := syscall.Setpriority(syscall.PRIO_PROCESS, pid, policy.Nice); err != nil {
		result.Status = "failed"
		result.Err = err
		return result
	}
	result.Status = "applied"
	result.Err = nil
	return result
}

func terminateLSPProcess(process *os.Process, wait time.Duration) {
	if process == nil {
		return
	}
	pid := process.Pid
	if pid <= 0 {
		_ = process.Kill()
		return
	}
	pgid, err := syscall.Getpgid(pid)
	if err != nil || pgid != pid {
		_ = process.Kill()
		return
	}
	_ = syscall.Kill(-pid, syscall.SIGTERM)
	if wait > 0 {
		timer := time.NewTimer(wait)
		<-timer.C
		timer.Stop()
	}
	_ = syscall.Kill(-pid, syscall.SIGKILL)
}
