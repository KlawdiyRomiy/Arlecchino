package indexer

type RelationType string

const (
	RelationTypeRoute      RelationType = "route"
	RelationTypeController RelationType = "controller"
	RelationTypeModel      RelationType = "model"
	RelationTypeView       RelationType = "view"
	RelationTypeMigration  RelationType = "migration"
)

type FileRelation struct {
	Path        string       `json:"path"`
	Type        RelationType `json:"type"`
	LineNumber  int          `json:"lineNumber"`
	Description string       `json:"description"`
}

type NodeSymbol struct {
	Name string `json:"name"`
	Kind string `json:"kind"`
	Line int    `json:"line"`
}

type DependencyNode struct {
	Path    string       `json:"path"`
	Symbols []NodeSymbol `json:"symbols"`
}

type DependencyEdge struct {
	Source string `json:"source"`
	Target string `json:"target"`
	Kind   string `json:"kind"`
	Line   int    `json:"line"`
}

type DependencyGraph struct {
	Nodes []DependencyNode `json:"nodes"`
	Edges []DependencyEdge `json:"edges"`
}
