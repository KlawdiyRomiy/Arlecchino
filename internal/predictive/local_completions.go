package predictive

import (
	"strings"

	sitter "github.com/smacker/go-tree-sitter"
)

type LocalCompletions struct {
	safeParser *SafeParser
}

func NewLocalCompletions() *LocalCompletions {
	return &LocalCompletions{
		safeParser: GetSafeParser(),
	}
}

// LocalSymbol represents a symbol found in the local file
type LocalSymbol struct {
	Name      string
	Kind      string // variable, method, property, function, class, etc.
	Type      string // type annotation if available
	Signature string // for methods/functions
	Line      int
	IsInScope bool // whether symbol is in current scope
}

// GetCompletions returns completions from local file analysis
func (lc *LocalCompletions) GetCompletions(filePath string, content []byte, line, column int, prefix string) []LocalSymbol {
	language := lc.detectLanguage(filePath)

	var symbols []LocalSymbol

	// Extract symbols based on language
	switch language {
	case "php":
		symbols = lc.extractPHPSymbols(content, line, prefix)
	case "go":
		symbols = lc.extractGoSymbols(content, line, prefix)
	case "typescript", "javascript":
		symbols = lc.extractJSSymbols(content, line, prefix, language)
	case "python":
		symbols = lc.extractPythonSymbols(content, line, prefix)
	}

	// Filter by prefix
	prefixLower := strings.ToLower(prefix)
	var filtered []LocalSymbol
	for _, s := range symbols {
		if prefix != "" && !strings.HasPrefix(strings.ToLower(s.Name), prefixLower) {
			continue
		}
		if prefix != "" && strings.EqualFold(s.Name, prefix) && !localSymbolAddsUsefulSuffix(s) {
			continue
		}
		filtered = append(filtered, s)
	}

	return filtered
}

func localSymbolAddsUsefulSuffix(symbol LocalSymbol) bool {
	switch symbol.Kind {
	case "function", "method":
		return true
	default:
		return false
	}
}

func (lc *LocalCompletions) detectLanguage(filePath string) string {
	if strings.HasSuffix(filePath, ".php") {
		return "php"
	}
	if strings.HasSuffix(filePath, ".go") {
		return "go"
	}
	if strings.HasSuffix(filePath, ".ts") || strings.HasSuffix(filePath, ".tsx") {
		return "typescript"
	}
	if strings.HasSuffix(filePath, ".js") || strings.HasSuffix(filePath, ".jsx") {
		return "javascript"
	}
	if strings.HasSuffix(filePath, ".py") {
		return "python"
	}
	return "unknown"
}

// extractPHPSymbols extracts symbols from PHP file using Tree-sitter AST
func (lc *LocalCompletions) extractPHPSymbols(content []byte, cursorLine int, prefix string) []LocalSymbol {
	tree, err := lc.safeParser.Parse("php", content)
	if err != nil || tree == nil {
		return nil
	}
	defer tree.Close()

	root := tree.RootNode()
	symbols := lc.walkPHPTree(root, content, cursorLine)

	if lc.isCursorInsidePHPClass(root, cursorLine) {
		symbols = append(symbols, LocalSymbol{
			Name:      "$this",
			Kind:      "variable",
			Line:      0,
			IsInScope: true,
		})
	}

	return symbols
}

func (lc *LocalCompletions) isCursorInsidePHPClass(node *sitter.Node, cursorLine int) bool {
	for i := uint32(0); i < node.NamedChildCount(); i++ {
		child := node.NamedChild(int(i))
		if child.Type() == "class_declaration" {
			startLine := int(child.StartPoint().Row) + 1
			endLine := int(child.EndPoint().Row) + 1
			if startLine <= cursorLine && endLine >= cursorLine {
				return true
			}
		}
		if lc.isCursorInsidePHPClass(child, cursorLine) {
			return true
		}
	}
	return false
}

func (lc *LocalCompletions) walkPHPTree(node *sitter.Node, content []byte, cursorLine int) []LocalSymbol {
	var symbols []LocalSymbol

	for i := uint32(0); i < node.NamedChildCount(); i++ {
		child := node.NamedChild(int(i))
		nodeType := child.Type()

		switch nodeType {
		case "class_declaration":
			if name := lc.findChildByType(child, "name"); name != nil {
				symbols = append(symbols, LocalSymbol{
					Name: name.Content(content),
					Kind: "class",
					Line: int(child.StartPoint().Row) + 1,
				})
			}
			// Also walk class body for methods and properties
			if body := lc.findChildByType(child, "declaration_list"); body != nil {
				symbols = append(symbols, lc.walkPHPClassBody(body, content, cursorLine)...)
			}

		case "function_definition":
			if name := lc.findChildByType(child, "name"); name != nil {
				signature := lc.extractPHPFunctionSignature(child, content)
				symbols = append(symbols, LocalSymbol{
					Name:      name.Content(content),
					Kind:      "function",
					Signature: signature,
					Line:      int(child.StartPoint().Row) + 1,
				})
			}

		case "namespace_definition":
			// Skip namespace itself, but continue walking children
		}

		// Recurse into child nodes
		symbols = append(symbols, lc.walkPHPTree(child, content, cursorLine)...)
	}

	return symbols
}

func (lc *LocalCompletions) walkPHPClassBody(node *sitter.Node, content []byte, cursorLine int) []LocalSymbol {
	var symbols []LocalSymbol

	for i := uint32(0); i < node.NamedChildCount(); i++ {
		child := node.NamedChild(int(i))
		nodeType := child.Type()

		switch nodeType {
		case "method_declaration":
			methodStartLine := int(child.StartPoint().Row) + 1
			methodEndLine := int(child.EndPoint().Row) + 1
			isInScope := methodStartLine <= cursorLine && methodEndLine >= cursorLine

			if name := lc.findChildByType(child, "name"); name != nil {
				signature := lc.extractPHPMethodSignature(child, content)
				symbols = append(symbols, LocalSymbol{
					Name:      name.Content(content),
					Kind:      "method",
					Signature: signature,
					Line:      methodStartLine,
					IsInScope: isInScope,
				})
			}

			if isInScope {
				if params := lc.findChildByType(child, "formal_parameters"); params != nil {
					symbols = append(symbols, lc.extractPHPParameters(params, content, cursorLine)...)
				}
				if body := lc.findChildByType(child, "compound_statement"); body != nil {
					symbols = append(symbols, lc.extractPHPLocalVariables(body, content, cursorLine)...)
				}
			}

		case "property_declaration":
			// Extract property names
			for j := uint32(0); j < child.NamedChildCount(); j++ {
				prop := child.NamedChild(int(j))
				if prop.Type() == "property_element" {
					if varNode := lc.findChildByType(prop, "variable_name"); varNode != nil {
						symbols = append(symbols, LocalSymbol{
							Name: strings.TrimPrefix(varNode.Content(content), "$"),
							Kind: "property",
							Line: int(child.StartPoint().Row) + 1,
						})
					}
				}
			}

		case "const_declaration":
			for j := uint32(0); j < child.NamedChildCount(); j++ {
				constElem := child.NamedChild(int(j))
				if constElem.Type() == "const_element" {
					if name := lc.findChildByType(constElem, "name"); name != nil {
						symbols = append(symbols, LocalSymbol{
							Name: name.Content(content),
							Kind: "constant",
							Line: int(child.StartPoint().Row) + 1,
						})
					}
				}
			}
		}
	}

	return symbols
}

func (lc *LocalCompletions) extractPHPFunctionSignature(node *sitter.Node, content []byte) string {
	if params := lc.findChildByType(node, "formal_parameters"); params != nil {
		return params.Content(content)
	}
	return "()"
}

func (lc *LocalCompletions) extractPHPParameters(node *sitter.Node, content []byte, cursorLine int) []LocalSymbol {
	var symbols []LocalSymbol

	for i := uint32(0); i < node.NamedChildCount(); i++ {
		child := node.NamedChild(int(i))
		if child.Type() == "simple_parameter" || child.Type() == "variadic_parameter" {
			var paramName string
			var paramType string

			for j := uint32(0); j < child.NamedChildCount(); j++ {
				paramChild := child.NamedChild(int(j))
				switch paramChild.Type() {
				case "variable_name":
					paramName = paramChild.Content(content)
				case "type_list", "named_type", "primitive_type", "optional_type", "union_type":
					paramType = paramChild.Content(content)
				}
			}

			if paramName != "" {
				symbols = append(symbols, LocalSymbol{
					Name:      paramName,
					Kind:      "parameter",
					Type:      paramType,
					Line:      int(child.StartPoint().Row) + 1,
					IsInScope: true,
				})
			}
		}
	}

	return symbols
}

func (lc *LocalCompletions) extractPHPLocalVariables(node *sitter.Node, content []byte, cursorLine int) []LocalSymbol {
	var symbols []LocalSymbol
	lc.walkPHPCompoundStatement(node, content, cursorLine, &symbols)
	return symbols
}

func (lc *LocalCompletions) walkPHPCompoundStatement(node *sitter.Node, content []byte, cursorLine int, symbols *[]LocalSymbol) {
	for i := uint32(0); i < node.NamedChildCount(); i++ {
		child := node.NamedChild(int(i))
		childLine := int(child.StartPoint().Row) + 1

		if childLine > cursorLine {
			continue
		}

		switch child.Type() {
		case "expression_statement":
			if assign := lc.findChildByType(child, "assignment_expression"); assign != nil {
				lc.extractPHPAssignment(assign, content, cursorLine, symbols)
			}

		case "foreach_statement":
			lc.extractPHPForeachVariables(child, content, cursorLine, symbols)
			if body := lc.findChildByType(child, "compound_statement"); body != nil {
				lc.walkPHPCompoundStatement(body, content, cursorLine, symbols)
			}

		case "for_statement":
			if body := lc.findChildByType(child, "compound_statement"); body != nil {
				lc.walkPHPCompoundStatement(body, content, cursorLine, symbols)
			}

		case "while_statement", "do_statement":
			if body := lc.findChildByType(child, "compound_statement"); body != nil {
				lc.walkPHPCompoundStatement(body, content, cursorLine, symbols)
			}

		case "if_statement":
			for j := uint32(0); j < child.NamedChildCount(); j++ {
				ifChild := child.NamedChild(int(j))
				if ifChild.Type() == "compound_statement" {
					lc.walkPHPCompoundStatement(ifChild, content, cursorLine, symbols)
				}
			}

		case "try_statement":
			if tryBody := lc.findChildByType(child, "compound_statement"); tryBody != nil {
				lc.walkPHPCompoundStatement(tryBody, content, cursorLine, symbols)
			}
			for j := uint32(0); j < child.NamedChildCount(); j++ {
				catchChild := child.NamedChild(int(j))
				if catchChild.Type() == "catch_clause" {
					if catchBody := lc.findChildByType(catchChild, "compound_statement"); catchBody != nil {
						lc.walkPHPCompoundStatement(catchBody, content, cursorLine, symbols)
					}
				}
			}

		case "switch_statement":
			if body := lc.findChildByType(child, "switch_block"); body != nil {
				lc.walkPHPCompoundStatement(body, content, cursorLine, symbols)
			}

		case "case_statement":
			for j := uint32(0); j < child.NamedChildCount(); j++ {
				caseChild := child.NamedChild(int(j))
				if caseChild.Type() == "expression_statement" {
					if assign := lc.findChildByType(caseChild, "assignment_expression"); assign != nil {
						lc.extractPHPAssignment(assign, content, cursorLine, symbols)
					}
				}
			}
		}
	}
}

func (lc *LocalCompletions) extractPHPAssignment(node *sitter.Node, content []byte, cursorLine int, symbols *[]LocalSymbol) {
	if node.NamedChildCount() >= 1 {
		left := node.NamedChild(0)
		if left.Type() == "variable_name" {
			varName := left.Content(content)
			for _, s := range *symbols {
				if s.Name == varName {
					return
				}
			}
			*symbols = append(*symbols, LocalSymbol{
				Name:      varName,
				Kind:      "variable",
				Line:      int(node.StartPoint().Row) + 1,
				IsInScope: true,
			})
		}
	}
}

func (lc *LocalCompletions) extractPHPForeachVariables(node *sitter.Node, content []byte, cursorLine int, symbols *[]LocalSymbol) {
	for i := uint32(0); i < node.NamedChildCount(); i++ {
		child := node.NamedChild(int(i))
		if child.Type() == "pair" {
			if key := lc.findChildByType(child, "variable_name"); key != nil {
				*symbols = append(*symbols, LocalSymbol{
					Name:      key.Content(content),
					Kind:      "variable",
					Line:      int(child.StartPoint().Row) + 1,
					IsInScope: true,
				})
			}
		} else if child.Type() == "variable_name" {
			*symbols = append(*symbols, LocalSymbol{
				Name:      child.Content(content),
				Kind:      "variable",
				Line:      int(child.StartPoint().Row) + 1,
				IsInScope: true,
			})
		}
	}
}

func (lc *LocalCompletions) extractPHPMethodSignature(node *sitter.Node, content []byte) string {
	var visibility string
	if vis := lc.findChildByFieldName(node, "visibility"); vis != nil {
		visibility = vis.Content(content) + " "
	}

	params := "()"
	if p := lc.findChildByType(node, "formal_parameters"); p != nil {
		params = p.Content(content)
	}

	returnType := ""
	if ret := lc.findChildByType(node, "return_type"); ret != nil {
		returnType = ": " + ret.Content(content)
	}

	return visibility + params + returnType
}

// extractGoSymbols extracts symbols from Go file using Tree-sitter AST
func (lc *LocalCompletions) extractGoSymbols(content []byte, cursorLine int, prefix string) []LocalSymbol {
	tree, err := lc.safeParser.Parse("go", content)
	if err != nil || tree == nil {
		return nil
	}
	defer tree.Close()

	root := tree.RootNode()
	var symbols []LocalSymbol

	for i := uint32(0); i < root.NamedChildCount(); i++ {
		child := root.NamedChild(int(i))
		nodeType := child.Type()

		switch nodeType {
		case "type_declaration":
			if spec := lc.findChildByType(child, "type_spec"); spec != nil {
				if name := lc.findChildByType(spec, "type_identifier"); name != nil {
					kind := "type"
					if lc.findChildByType(spec, "struct_type") != nil {
						kind = "struct"
					} else if lc.findChildByType(spec, "interface_type") != nil {
						kind = "interface"
					}
					symbols = append(symbols, LocalSymbol{
						Name: name.Content(content),
						Kind: kind,
						Line: int(child.StartPoint().Row) + 1,
					})
				}
			}

		case "function_declaration":
			if name := lc.findChildByType(child, "identifier"); name != nil {
				signature := lc.extractGoFunctionSignature(child, content)
				symbols = append(symbols, LocalSymbol{
					Name:      name.Content(content),
					Kind:      "function",
					Signature: signature,
					Line:      int(child.StartPoint().Row) + 1,
				})
			}

		case "method_declaration":
			if name := lc.findChildByType(child, "field_identifier"); name != nil {
				signature := lc.extractGoMethodSignature(child, content)
				symbols = append(symbols, LocalSymbol{
					Name:      name.Content(content),
					Kind:      "method",
					Signature: signature,
					Line:      int(child.StartPoint().Row) + 1,
				})
			}

		case "var_declaration", "const_declaration":
			for j := uint32(0); j < child.NamedChildCount(); j++ {
				spec := child.NamedChild(int(j))
				if spec.Type() == "var_spec" || spec.Type() == "const_spec" {
					if name := lc.findChildByType(spec, "identifier"); name != nil {
						kind := "variable"
						if nodeType == "const_declaration" {
							kind = "constant"
						}
						symbols = append(symbols, LocalSymbol{
							Name: name.Content(content),
							Kind: kind,
							Line: int(child.StartPoint().Row) + 1,
						})
					}
				}
			}
		}
	}

	return symbols
}

func (lc *LocalCompletions) extractGoFunctionSignature(node *sitter.Node, content []byte) string {
	if params := lc.findChildByType(node, "parameter_list"); params != nil {
		return params.Content(content)
	}
	return "()"
}

func (lc *LocalCompletions) extractGoMethodSignature(node *sitter.Node, content []byte) string {
	receiver := ""
	if recv := lc.findChildByFieldName(node, "receiver"); recv != nil {
		receiver = recv.Content(content) + " "
	}

	params := "()"
	if p := lc.findChildByType(node, "parameter_list"); p != nil {
		params = p.Content(content)
	}

	return receiver + params
}

// extractJSSymbols extracts symbols from JavaScript/TypeScript file using Tree-sitter AST
func (lc *LocalCompletions) extractJSSymbols(content []byte, cursorLine int, prefix string, language string) []LocalSymbol {
	tree, err := lc.safeParser.Parse(language, content)
	if err != nil || tree == nil {
		return nil
	}
	defer tree.Close()

	root := tree.RootNode()
	return lc.walkJSTree(root, content, cursorLine)
}

func (lc *LocalCompletions) walkJSTree(node *sitter.Node, content []byte, cursorLine int) []LocalSymbol {
	var symbols []LocalSymbol

	for i := uint32(0); i < node.NamedChildCount(); i++ {
		child := node.NamedChild(int(i))
		nodeType := child.Type()

		switch nodeType {
		case "class_declaration":
			name := lc.findChildByType(child, "type_identifier")
			if name == nil {
				name = lc.findChildByType(child, "identifier")
			}
			if name != nil {
				symbols = append(symbols, LocalSymbol{
					Name: name.Content(content),
					Kind: "class",
					Line: int(child.StartPoint().Row) + 1,
				})
			}
			if body := lc.findChildByType(child, "class_body"); body != nil {
				symbols = append(symbols, lc.walkJSClassBody(body, content, cursorLine)...)
			}

		case "function_declaration":
			if name := lc.findChildByType(child, "identifier"); name != nil {
				symbols = append(symbols, LocalSymbol{
					Name: name.Content(content),
					Kind: "function",
					Line: int(child.StartPoint().Row) + 1,
				})
			}

		case "lexical_declaration", "variable_declaration":
			for j := uint32(0); j < child.NamedChildCount(); j++ {
				decl := child.NamedChild(int(j))
				if decl.Type() == "variable_declarator" {
					if name := lc.findChildByType(decl, "identifier"); name != nil {
						kind := "variable"
						// Check if it's a const
						for k := uint32(0); k < child.ChildCount(); k++ {
							if child.Child(int(k)).Type() == "const" {
								kind = "constant"
								break
							}
						}
						symbols = append(symbols, LocalSymbol{
							Name: name.Content(content),
							Kind: kind,
							Line: int(child.StartPoint().Row) + 1,
						})
					}
				}
			}

		case "export_statement":
			// Walk exported declarations
			symbols = append(symbols, lc.walkJSTree(child, content, cursorLine)...)

		case "interface_declaration":
			if name := lc.findChildByType(child, "type_identifier"); name != nil {
				symbols = append(symbols, LocalSymbol{
					Name: name.Content(content),
					Kind: "interface",
					Line: int(child.StartPoint().Row) + 1,
				})
			}

		case "type_alias_declaration":
			if name := lc.findChildByType(child, "type_identifier"); name != nil {
				symbols = append(symbols, LocalSymbol{
					Name: name.Content(content),
					Kind: "type",
					Line: int(child.StartPoint().Row) + 1,
				})
			}
		}
	}

	return symbols
}

func (lc *LocalCompletions) walkJSClassBody(node *sitter.Node, content []byte, cursorLine int) []LocalSymbol {
	var symbols []LocalSymbol

	for i := uint32(0); i < node.NamedChildCount(); i++ {
		child := node.NamedChild(int(i))
		nodeType := child.Type()

		switch nodeType {
		case "method_definition":
			if name := lc.findChildByType(child, "property_identifier"); name != nil {
				symbols = append(symbols, LocalSymbol{
					Name: name.Content(content),
					Kind: "method",
					Line: int(child.StartPoint().Row) + 1,
				})
			}

		case "public_field_definition", "field_definition":
			if name := lc.findChildByType(child, "property_identifier"); name != nil {
				symbols = append(symbols, LocalSymbol{
					Name: name.Content(content),
					Kind: "property",
					Line: int(child.StartPoint().Row) + 1,
				})
			}
		}
	}

	return symbols
}

// extractPythonSymbols extracts symbols from Python file using Tree-sitter AST
func (lc *LocalCompletions) extractPythonSymbols(content []byte, cursorLine int, prefix string) []LocalSymbol {
	tree, err := lc.safeParser.Parse("python", content)
	if err != nil || tree == nil {
		return nil
	}
	defer tree.Close()

	root := tree.RootNode()
	return lc.walkPythonTree(root, content, cursorLine, 0)
}

func (lc *LocalCompletions) walkPythonTree(node *sitter.Node, content []byte, cursorLine int, depth int) []LocalSymbol {
	var symbols []LocalSymbol

	for i := uint32(0); i < node.NamedChildCount(); i++ {
		child := node.NamedChild(int(i))
		nodeType := child.Type()

		switch nodeType {
		case "class_definition":
			if name := lc.findChildByType(child, "identifier"); name != nil {
				symbols = append(symbols, LocalSymbol{
					Name: name.Content(content),
					Kind: "class",
					Line: int(child.StartPoint().Row) + 1,
				})
			}
			if body := lc.findChildByType(child, "block"); body != nil {
				symbols = append(symbols, lc.walkPythonTree(body, content, cursorLine, depth+1)...)
			}

		case "function_definition":
			if name := lc.findChildByType(child, "identifier"); name != nil {
				kind := "function"
				if depth > 0 {
					kind = "method"
				}
				symbols = append(symbols, LocalSymbol{
					Name: name.Content(content),
					Kind: kind,
					Line: int(child.StartPoint().Row) + 1,
				})
			}

		case "assignment":
			// Module-level assignments
			if depth == 0 {
				if name := lc.findChildByType(child, "identifier"); name != nil {
					symbols = append(symbols, LocalSymbol{
						Name: name.Content(content),
						Kind: "variable",
						Line: int(child.StartPoint().Row) + 1,
					})
				}
			}

		case "expression_statement":
			// May contain assignment
			if depth == 0 {
				if assign := lc.findChildByType(child, "assignment"); assign != nil {
					if name := lc.findChildByType(assign, "identifier"); name != nil {
						symbols = append(symbols, LocalSymbol{
							Name: name.Content(content),
							Kind: "variable",
							Line: int(child.StartPoint().Row) + 1,
						})
					}
				}
			}
		}
	}

	return symbols
}

// Helper functions

func (lc *LocalCompletions) findChildByType(node *sitter.Node, childType string) *sitter.Node {
	for i := uint32(0); i < node.ChildCount(); i++ {
		child := node.Child(int(i))
		if child.Type() == childType {
			return child
		}
	}
	return nil
}

func (lc *LocalCompletions) findChildByFieldName(node *sitter.Node, fieldName string) *sitter.Node {
	return node.ChildByFieldName(fieldName)
}

// Close closes the local completions provider
func (lc *LocalCompletions) Close() {
	// SafeParser is a global singleton, don't close it here
}
