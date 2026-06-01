package adapters

import (
	"testing"

	"arlecchino/internal/indexer/core"
)

func TestRubyAdapter_ParseContent(t *testing.T) {
	adapter := NewRubyAdapter()

	tests := []struct {
		name          string
		content       string
		wantSymbols   []string
		wantKinds     []core.SymbolKind
		wantEdgeCount int
	}{
		{
			name: "Rails controller",
			content: `class UsersController < ApplicationController
  def index
    @users = User.all
  end

  def show
    @user = User.find(params[:id])
  end

  private

  def user_params
    params.require(:user).permit(:name, :email)
  end
end`,
			wantSymbols:   []string{"UsersController", "index", "show", "user_params"},
			wantKinds:     []core.SymbolKind{core.SymbolKindClass, core.SymbolKindMethod, core.SymbolKindMethod, core.SymbolKindMethod},
			wantEdgeCount: 1,
		},
		{
			name: "Rails model with attributes",
			content: `class User < ApplicationRecord
  attr_accessor :name, :email
  attr_reader :id

  ROLES = %w[admin user guest].freeze

  def full_name
    "#{first_name} #{last_name}"
  end
end`,
			wantSymbols:   []string{"User", "name", "email", "id", "ROLES", "full_name"},
			wantKinds:     []core.SymbolKind{core.SymbolKindClass, core.SymbolKindProperty, core.SymbolKindProperty, core.SymbolKindProperty, core.SymbolKindConstant, core.SymbolKindMethod},
			wantEdgeCount: 1,
		},
		{
			name: "Module with class methods",
			content: `module Authentication
  def self.sign_in(user)
    session[:user_id] = user.id
  end

  def self.current_user
    @current_user ||= User.find(session[:user_id])
  end
end`,
			wantSymbols:   []string{"Authentication", "sign_in", "current_user"},
			wantKinds:     []core.SymbolKind{core.SymbolKindModule, core.SymbolKindMethod, core.SymbolKindMethod},
			wantEdgeCount: 0,
		},
		{
			name: "Require statements",
			content: `require 'json'
require_relative 'concerns/searchable'

class Product
end`,
			wantSymbols:   []string{"Product"},
			wantKinds:     []core.SymbolKind{core.SymbolKindClass},
			wantEdgeCount: 2,
		},
		{
			name: "Include and extend",
			content: `class Post
  include Searchable
  extend ClassMethods

  def title
    @title
  end
end`,
			wantSymbols:   []string{"Post", "title"},
			wantKinds:     []core.SymbolKind{core.SymbolKindClass, core.SymbolKindMethod},
			wantEdgeCount: 2,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			symbols, edges, err := adapter.ParseContent("test.rb", []byte(tt.content))
			if err != nil {
				t.Fatalf("ParseContent error: %v", err)
			}

			if len(symbols) != len(tt.wantSymbols) {
				t.Errorf("got %d symbols, want %d", len(symbols), len(tt.wantSymbols))
				for i, s := range symbols {
					t.Logf("  symbol[%d]: %s (%s)", i, s.Name, s.Kind)
				}
			}

			for i, want := range tt.wantSymbols {
				if i >= len(symbols) {
					break
				}
				if symbols[i].Name != want {
					t.Errorf("symbol[%d].Name = %q, want %q", i, symbols[i].Name, want)
				}
				if symbols[i].Kind != tt.wantKinds[i] {
					t.Errorf("symbol[%d].Kind = %v, want %v", i, symbols[i].Kind, tt.wantKinds[i])
				}
			}

			if len(edges) != tt.wantEdgeCount {
				t.Errorf("got %d edges, want %d", len(edges), tt.wantEdgeCount)
				for i, e := range edges {
					t.Logf("  edge[%d]: %s -> %s (%s)", i, e.FromSymbol, e.ToSymbol, e.Kind)
				}
			}
		})
	}
}

func TestRubyAdapter_Extensions(t *testing.T) {
	adapter := NewRubyAdapter()
	exts := adapter.Extensions()

	expected := []string{".rb", ".rake", ".gemspec", ".ru", ".erb"}
	if len(exts) != len(expected) {
		t.Errorf("got %d extensions, want %d", len(exts), len(expected))
	}

	for i, ext := range expected {
		if exts[i] != ext {
			t.Errorf("extension[%d] = %q, want %q", i, exts[i], ext)
		}
	}
}

func TestRubyAdapter_Language(t *testing.T) {
	adapter := NewRubyAdapter()
	if adapter.Language() != "ruby" {
		t.Errorf("Language() = %q, want %q", adapter.Language(), "ruby")
	}
}
