package plugins

type ModelField struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Nullable bool   `json:"nullable"`
	Default  string `json:"default,omitempty"`
}

type ModelRelationship struct {
	Name   string `json:"name"`
	Type   string `json:"type"`
	Model  string `json:"model"`
	Method string `json:"method"`
}

type ModelEntry struct {
	Name          string              `json:"name"`
	Table         string              `json:"table"`
	Fields        []ModelField        `json:"fields"`
	Fillable      []string            `json:"fillable"`
	Hidden        []string            `json:"hidden"`
	Casts         map[string]string   `json:"casts"`
	Relationships []ModelRelationship `json:"relationships"`
	FilePath      string              `json:"filePath"`
}

type RouteEntry struct {
	Name           string   `json:"name"`
	Method         string   `json:"method"`
	URI            string   `json:"uri"`
	Action         string   `json:"action"`
	Controller     string   `json:"controller"`
	Middleware     []string `json:"middleware"`
	FilePath       string   `json:"filePath"`
	LineNumber     int      `json:"lineNumber"`
	ControllerPath string   `json:"controllerPath"`
	ActionLine     int      `json:"actionLine"`
}

type ViewEntry struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	RelPath  string `json:"relPath"`
	IsLayout bool   `json:"isLayout"`
}

type ConfigEntry struct {
	Key         string `json:"key"`
	Value       string `json:"value,omitempty"`
	File        string `json:"file"`
	Description string `json:"description,omitempty"`
}

type ControllerOptions struct {
	Resource  bool
	Api       bool
	Plain     bool
	Invokable bool
	Model     string
	Parent    string
	Singleton bool
	Requests  bool
}

type ModelOptions struct {
	All        bool
	Controller bool
	Factory    bool
	Invokable  bool
	Migration  bool
	Policy     bool
	Resource   bool
	Seeder     bool
}

type MailOptions struct {
	Markdown string
}

type NotificationOptions struct {
	Force bool
}

type JobOptions struct {
	Sync bool
}

type ComponentOptions struct {
	Force     bool
	Plain     bool
	Invokable bool
}

type LivewireComponentOptions struct {
	Force     bool
	Inline    bool
	Plain     bool
	Invokable bool
	SkipViews bool
}

type EnumClassOptions struct {
	Force bool
}

type EventClassOptions struct {
	Force bool
}

type ResourceClassOptions struct {
	Collection bool
	Force      bool
	Invokable  bool
	Model      string
}

type FactoryClassOptions struct {
	Force  bool
	Model  string
	Seeded bool
}

type SeederClassOptions struct {
	Force bool
	Class string
}

type PolicyClassOptions struct {
	Force    bool
	Model    string
	Guard    string
	Resource bool
}

type MigrationOptions struct {
	Create string
	Table  string
	Path   string
	Force  bool
}

type DefinitionProvider interface {
	Plugin
	RouteEntries() ([]RouteEntry, error)
	ViewEntries() ([]ViewEntry, error)
	ModelEntries() (map[string]ModelEntry, error)
	ConfigEntries() ([]ConfigEntry, error)
}

type ArtisanExecutor interface {
	RunMigrate() error
	CreateModel(name string, opts ModelOptions) error
	CreateController(name string, opts ControllerOptions) error
	CreateMail(name string, opts MailOptions) error
	CreateNotifications(name string, opts NotificationOptions) error
	CreateComponent(name string, opts ComponentOptions) error
	CreateLivewire(name string, opts LivewireComponentOptions) error
	CreateEnum(name string, opts EnumClassOptions) error
	CreateEvent(name string, opts EventClassOptions) error
	CreateJob(name string, opts JobOptions) error
	CreateResource(name string, opts ResourceClassOptions) error
	CreateFactory(name string, opts FactoryClassOptions) error
	CreateSeeder(name string, opts SeederClassOptions) error
	CreatePolicy(name string, opts PolicyClassOptions) error
	CreateMigration(name string, opts MigrationOptions) error
}

type ArtisanPlugin interface {
	Plugin
	EnsureArtisanExecutor() (ArtisanExecutor, error)
}

type RuntimeInspector interface {
	GetMiddlewareList() (interface{}, error)
	GetRouteList(filter string) (interface{}, error)
	AnalyzeModels(modelName string) (interface{}, error)
	ExecuteQuery(query string, bindings []interface{}) (interface{}, error)
	InspectProject() (interface{}, error)
}

type RuntimePlugin interface {
	Plugin
	EnsureRuntimeInspector() (RuntimeInspector, error)
}
