package lsp

import (
	"os"
	"strconv"
	"strings"
)

const defaultLSPProcessNice = 10

type lspProcessPriorityPolicy struct {
	Enabled bool
	Nice    int
	Source  string
}

type lspProcessPriorityResult struct {
	Policy lspProcessPriorityPolicy
	Target string
	Status string
	Err    error
}

func currentLSPProcessPriorityPolicy() lspProcessPriorityPolicy {
	return lspProcessPriorityPolicyFromEnv(os.Getenv)
}

func lspProcessPriorityPolicyFromEnv(getenv func(string) string) lspProcessPriorityPolicy {
	if getenv == nil {
		getenv = os.Getenv
	}

	if isDisabledEnvValue(getenv("ARLECCHINO_LSP_LOW_IMPACT")) {
		return lspProcessPriorityPolicy{Enabled: false, Nice: 0, Source: "disabled"}
	}

	rawNice := strings.TrimSpace(getenv("ARLECCHINO_LSP_NICE"))
	if rawNice == "" {
		return lspProcessPriorityPolicy{Enabled: true, Nice: defaultLSPProcessNice, Source: "default"}
	}

	nice, err := strconv.Atoi(rawNice)
	if err != nil {
		return lspProcessPriorityPolicy{Enabled: true, Nice: defaultLSPProcessNice, Source: "invalid-env"}
	}
	if nice <= 0 {
		return lspProcessPriorityPolicy{Enabled: false, Nice: 0, Source: "env"}
	}
	if nice > 19 {
		nice = 19
	}
	return lspProcessPriorityPolicy{Enabled: true, Nice: nice, Source: "env"}
}

func isDisabledEnvValue(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "0", "false", "off", "no", "disabled":
		return true
	default:
		return false
	}
}
