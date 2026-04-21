package execution

type ProfileKind string

const (
	ProfileKindTerminal ProfileKind = "terminal"
	ProfileKindPreview  ProfileKind = "preview"
)

type ProfileMode string

const (
	ProfileModeRun   ProfileMode = "run"
	ProfileModeDebug ProfileMode = "debug"
)

type ProfileOrigin string

const (
	ProfileOriginAuto     ProfileOrigin = "auto"
	ProfileOriginPlugin   ProfileOrigin = "plugin"
	ProfileOriginImported ProfileOrigin = "imported"
	ProfileOriginUser     ProfileOrigin = "user"
)

type Profile struct {
	ID               string            `json:"id"`
	Label            string            `json:"label"`
	Description      string            `json:"description"`
	Kind             ProfileKind       `json:"kind"`
	Mode             ProfileMode       `json:"mode"`
	Command          string            `json:"command"`
	WorkingDirectory string            `json:"workingDirectory,omitempty"`
	Language         string            `json:"language,omitempty"`
	Framework        string            `json:"framework,omitempty"`
	Origin           ProfileOrigin     `json:"origin,omitempty"`
	Confidence       float64           `json:"confidence,omitempty"`
	RequiredTools    []string          `json:"requiredTools,omitempty"`
	MissingTools     []string          `json:"missingTools,omitempty"`
	Env              map[string]string `json:"env,omitempty"`
}

type ProfileSet struct {
	RunProfiles   []Profile `json:"runProfiles"`
	DebugProfiles []Profile `json:"debugProfiles"`
}

type ResolveRequest struct {
	ProjectPath        string `json:"projectPath"`
	ActiveFilePath     string `json:"activeFilePath"`
	ActiveFileName     string `json:"activeFileName"`
	ActiveFileContent  string `json:"activeFileContent"`
	ActiveFileLanguage string `json:"activeFileLanguage"`
}
