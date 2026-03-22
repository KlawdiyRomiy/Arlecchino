package terminal

import (
	"strings"

	"mvdan.cc/sh/v3/syntax"
)

func ParseShellInput(input string) (*ParsedCommand, error) {
	if input == "" {
		return &ParsedCommand{IsIncomplete: true}, nil
	}

	parser := syntax.NewParser()
	file, err := parser.Parse(strings.NewReader(input), "")

	if err != nil {
		return &ParsedCommand{IsIncomplete: true}, nil
	}

	if file == nil || len(file.Stmts) == 0 {
		return &ParsedCommand{IsIncomplete: true}, nil
	}

	result := &ParsedCommand{
		Args:  make([]string, 0),
		Flags: make(map[string]string),
	}

	stmt := file.Stmts[0]

	if stmt.Cmd != nil {
		if _, isPipe := stmt.Cmd.(*syntax.BinaryCmd); isPipe {
			result.IsPipe = true
		}
	}

	if len(stmt.Redirs) > 0 {
		result.IsRedirect = true
	}

	if callExpr, ok := extractCallExpr(stmt.Cmd); ok {
		if len(callExpr.Args) > 0 {
			result.Binary = expandWord(callExpr.Args[0])

			for i := 1; i < len(callExpr.Args); i++ {
				arg := expandWord(callExpr.Args[i])

				if strings.HasPrefix(arg, "--") {
					parts := strings.SplitN(arg[2:], "=", 2)
					if len(parts) == 2 {
						result.Flags[parts[0]] = parts[1]
					} else {
						result.Flags[parts[0]] = ""
					}
				} else if strings.HasPrefix(arg, "-") && len(arg) > 1 {
					result.Flags[arg[1:]] = ""
				} else {
					result.Args = append(result.Args, arg)
				}
			}
		}
	}

	return result, nil
}

func extractCallExpr(cmd syntax.Command) (*syntax.CallExpr, bool) {
	if cmd == nil {
		return nil, false
	}

	switch c := cmd.(type) {
	case *syntax.CallExpr:
		return c, true
	case *syntax.BinaryCmd:
		if c.X != nil {
			return extractCallExprFromStmt(c.X.Cmd)
		}
		return nil, false
	default:
		return nil, false
	}
}

func extractCallExprFromStmt(cmd syntax.Command) (*syntax.CallExpr, bool) {
	if cmd == nil {
		return nil, false
	}

	switch c := cmd.(type) {
	case *syntax.CallExpr:
		return c, true
	case *syntax.BinaryCmd:
		if c.X != nil {
			return extractCallExprFromStmt(c.X.Cmd)
		}
		return nil, false
	default:
		return nil, false
	}
}

func expandWord(word *syntax.Word) string {
	if word == nil {
		return ""
	}

	var result strings.Builder
	for _, part := range word.Parts {
		switch p := part.(type) {
		case *syntax.Lit:
			result.WriteString(p.Value)
		case *syntax.SglQuoted:
			result.WriteString(p.Value)
		case *syntax.DblQuoted:
			for _, dPart := range p.Parts {
				if lit, ok := dPart.(*syntax.Lit); ok {
					result.WriteString(lit.Value)
				}
			}
		}
	}
	return result.String()
}
