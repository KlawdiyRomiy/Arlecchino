package treesitter

import (
	"fmt"

	"arlecchino/internal/indexer/core"
	"arlecchino/internal/predictive"

	sitter "github.com/smacker/go-tree-sitter"
)

type Parser struct {
	available  bool
	safeParser *predictive.SafeParser
}

func NewParser() *Parser {
	return &Parser{
		available:  true,
		safeParser: predictive.GetSafeParser(),
	}
}

func (p *Parser) Available() bool {
	return p.available
}

func (p *Parser) ParseFile(language, path string, content []byte) ([]core.Symbol, []core.Edge, error) {
	lang := language
	switch language {
	case "tsx", "jsx", "ts":
		lang = "typescript"
	case "js":
		lang = "javascript"
	case "py":
		lang = "python"
	}

	tree, err := p.safeParser.ParseLowPriority(lang, content)
	if err != nil {
		return nil, nil, fmt.Errorf("parse error: %w", err)
	}
	if tree == nil {
		return nil, nil, fmt.Errorf("unsupported language: %s", language)
	}
	defer tree.Close()

	var symbols []core.Symbol
	var edges []core.Edge

	root := tree.RootNode()
	p.walkNode(root, content, path, &symbols, &edges, language)

	return symbols, edges, nil
}

// walkNode recursively walks the AST and extracts symbols.
func (p *Parser) walkNode(node *sitter.Node, content []byte, filePath string, symbols *[]core.Symbol, edges *[]core.Edge, language string) {
	if node == nil {
		return
	}

	nodeType := node.Type()

	// Extract symbols based on node type and language
	switch language {
	case "php":
		p.extractPHPSymbol(node, content, filePath, symbols, edges)
	case "go":
		p.extractGoSymbol(node, content, filePath, symbols, edges)
	case "javascript", "typescript", "tsx", "jsx":
		p.extractJSSymbol(node, content, filePath, symbols, edges, nodeType)
	case "python":
		p.extractPythonSymbol(node, content, filePath, symbols, edges)
	}

	// Walk children
	for i := uint32(0); i < node.ChildCount(); i++ {
		child := node.Child(int(i))
		p.walkNode(child, content, filePath, symbols, edges, language)
	}
}

func (p *Parser) extractPHPSymbol(node *sitter.Node, content []byte, filePath string, symbols *[]core.Symbol, edges *[]core.Edge) {
	switch node.Type() {
	case "class_declaration":
		name := p.findChildByType(node, "name")
		if name != nil {
			*symbols = append(*symbols, core.Symbol{
				Name:      name.Content(content),
				Kind:      core.SymbolKindClass,
				FilePath:  filePath,
				Line:      int(node.StartPoint().Row) + 1,
				EndLine:   int(node.EndPoint().Row) + 1,
				Column:    int(node.StartPoint().Column),
				EndColumn: int(node.EndPoint().Column),
			})
		}
	case "method_declaration", "function_definition":
		name := p.findChildByType(node, "name")
		if name != nil {
			*symbols = append(*symbols, core.Symbol{
				Name:      name.Content(content),
				Kind:      core.SymbolKindMethod,
				FilePath:  filePath,
				Line:      int(node.StartPoint().Row) + 1,
				EndLine:   int(node.EndPoint().Row) + 1,
				Column:    int(node.StartPoint().Column),
				EndColumn: int(node.EndPoint().Column),
			})
		}
	case "property_declaration":
		name := p.findChildByType(node, "variable_name")
		if name != nil {
			*symbols = append(*symbols, core.Symbol{
				Name:      name.Content(content),
				Kind:      core.SymbolKindProperty,
				FilePath:  filePath,
				Line:      int(node.StartPoint().Row) + 1,
				EndLine:   int(node.EndPoint().Row) + 1,
				Column:    int(node.StartPoint().Column),
				EndColumn: int(node.EndPoint().Column),
			})
		}
	case "trait_declaration":
		name := p.findChildByType(node, "name")
		if name != nil {
			*symbols = append(*symbols, core.Symbol{
				Name:      name.Content(content),
				Kind:      core.SymbolKindTrait,
				FilePath:  filePath,
				Line:      int(node.StartPoint().Row) + 1,
				EndLine:   int(node.EndPoint().Row) + 1,
				Column:    int(node.StartPoint().Column),
				EndColumn: int(node.EndPoint().Column),
			})
		}
	case "interface_declaration":
		name := p.findChildByType(node, "name")
		if name != nil {
			*symbols = append(*symbols, core.Symbol{
				Name:      name.Content(content),
				Kind:      core.SymbolKindInterface,
				FilePath:  filePath,
				Line:      int(node.StartPoint().Row) + 1,
				EndLine:   int(node.EndPoint().Row) + 1,
				Column:    int(node.StartPoint().Column),
				EndColumn: int(node.EndPoint().Column),
			})
		}
	}
}

func (p *Parser) extractGoSymbol(node *sitter.Node, content []byte, filePath string, symbols *[]core.Symbol, edges *[]core.Edge) {
	switch node.Type() {
	case "type_declaration":
		for i := uint32(0); i < node.ChildCount(); i++ {
			child := node.Child(int(i))
			if child.Type() == "type_spec" {
				name := p.findChildByType(child, "type_identifier")
				if name != nil {
					kind := core.SymbolKindStruct
					if p.findChildByType(child, "interface_type") != nil {
						kind = core.SymbolKindInterface
					}
					*symbols = append(*symbols, core.Symbol{
						Name:      name.Content(content),
						Kind:      kind,
						FilePath:  filePath,
						Line:      int(child.StartPoint().Row) + 1,
						EndLine:   int(child.EndPoint().Row) + 1,
						Column:    int(child.StartPoint().Column),
						EndColumn: int(child.EndPoint().Column),
					})
				}
			}
		}
	case "function_declaration":
		name := p.findChildByType(node, "identifier")
		if name != nil {
			*symbols = append(*symbols, core.Symbol{
				Name:      name.Content(content),
				Kind:      core.SymbolKindFunction,
				FilePath:  filePath,
				Line:      int(node.StartPoint().Row) + 1,
				EndLine:   int(node.EndPoint().Row) + 1,
				Column:    int(node.StartPoint().Column),
				EndColumn: int(node.EndPoint().Column),
			})
		}
	case "method_declaration":
		name := p.findChildByType(node, "field_identifier")
		if name != nil {
			*symbols = append(*symbols, core.Symbol{
				Name:      name.Content(content),
				Kind:      core.SymbolKindMethod,
				FilePath:  filePath,
				Line:      int(node.StartPoint().Row) + 1,
				EndLine:   int(node.EndPoint().Row) + 1,
				Column:    int(node.StartPoint().Column),
				EndColumn: int(node.EndPoint().Column),
			})
		}
	}
}

func (p *Parser) extractJSSymbol(node *sitter.Node, content []byte, filePath string, symbols *[]core.Symbol, edges *[]core.Edge, nodeType string) {
	switch nodeType {
	case "class_declaration":
		name := p.findChildByType(node, "identifier")
		if name != nil {
			*symbols = append(*symbols, core.Symbol{
				Name:      name.Content(content),
				Kind:      core.SymbolKindClass,
				FilePath:  filePath,
				Line:      int(node.StartPoint().Row) + 1,
				EndLine:   int(node.EndPoint().Row) + 1,
				Column:    int(node.StartPoint().Column),
				EndColumn: int(node.EndPoint().Column),
			})
		}
	case "function_declaration":
		name := p.findChildByType(node, "identifier")
		if name != nil {
			*symbols = append(*symbols, core.Symbol{
				Name:      name.Content(content),
				Kind:      core.SymbolKindFunction,
				FilePath:  filePath,
				Line:      int(node.StartPoint().Row) + 1,
				EndLine:   int(node.EndPoint().Row) + 1,
				Column:    int(node.StartPoint().Column),
				EndColumn: int(node.EndPoint().Column),
			})
		}
	case "method_definition":
		name := p.findChildByType(node, "property_identifier")
		if name != nil {
			*symbols = append(*symbols, core.Symbol{
				Name:      name.Content(content),
				Kind:      core.SymbolKindMethod,
				FilePath:  filePath,
				Line:      int(node.StartPoint().Row) + 1,
				EndLine:   int(node.EndPoint().Row) + 1,
				Column:    int(node.StartPoint().Column),
				EndColumn: int(node.EndPoint().Column),
			})
		}
	case "interface_declaration":
		name := p.findChildByType(node, "type_identifier")
		if name != nil {
			*symbols = append(*symbols, core.Symbol{
				Name:      name.Content(content),
				Kind:      core.SymbolKindInterface,
				FilePath:  filePath,
				Line:      int(node.StartPoint().Row) + 1,
				EndLine:   int(node.EndPoint().Row) + 1,
				Column:    int(node.StartPoint().Column),
				EndColumn: int(node.EndPoint().Column),
			})
		}
	case "arrow_function", "function":
		// Variable with arrow function
		parent := node.Parent()
		if parent != nil && parent.Type() == "variable_declarator" {
			name := p.findChildByType(parent, "identifier")
			if name != nil {
				*symbols = append(*symbols, core.Symbol{
					Name:      name.Content(content),
					Kind:      core.SymbolKindFunction,
					FilePath:  filePath,
					Line:      int(node.StartPoint().Row) + 1,
					EndLine:   int(node.EndPoint().Row) + 1,
					Column:    int(node.StartPoint().Column),
					EndColumn: int(node.EndPoint().Column),
				})
			}
		}
	}
}

func (p *Parser) extractPythonSymbol(node *sitter.Node, content []byte, filePath string, symbols *[]core.Symbol, edges *[]core.Edge) {
	switch node.Type() {
	case "class_definition":
		name := p.findChildByType(node, "identifier")
		if name != nil {
			*symbols = append(*symbols, core.Symbol{
				Name:      name.Content(content),
				Kind:      core.SymbolKindClass,
				FilePath:  filePath,
				Line:      int(node.StartPoint().Row) + 1,
				EndLine:   int(node.EndPoint().Row) + 1,
				Column:    int(node.StartPoint().Column),
				EndColumn: int(node.EndPoint().Column),
			})
		}
	case "function_definition":
		name := p.findChildByType(node, "identifier")
		if name != nil {
			kind := core.SymbolKindFunction
			parent := node.Parent()
			if parent != nil && parent.Type() == "block" {
				grandparent := parent.Parent()
				if grandparent != nil && grandparent.Type() == "class_definition" {
					kind = core.SymbolKindMethod
				}
			}
			*symbols = append(*symbols, core.Symbol{
				Name:      name.Content(content),
				Kind:      kind,
				FilePath:  filePath,
				Line:      int(node.StartPoint().Row) + 1,
				EndLine:   int(node.EndPoint().Row) + 1,
				Column:    int(node.StartPoint().Column),
				EndColumn: int(node.EndPoint().Column),
			})
		}
	}
}

func (p *Parser) findChildByType(node *sitter.Node, childType string) *sitter.Node {
	for i := uint32(0); i < node.ChildCount(); i++ {
		child := node.Child(int(i))
		if child.Type() == childType {
			return child
		}
	}
	return nil
}

func (p *Parser) Close() {
}
