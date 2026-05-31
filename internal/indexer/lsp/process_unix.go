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
