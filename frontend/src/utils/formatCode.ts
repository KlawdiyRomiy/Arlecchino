export const formatCodeWithPrettier = async (
  content: string,
  filePath: string,
  language: string,
): Promise<string | null> => {
  const lowerPath = filePath.toLowerCase();
  const supported =
    [
      "php",
      "html",
      "javascript",
      "javascriptreact",
      "typescript",
      "typescriptreact",
      "css",
      "scss",
      "json",
      "markdown",
    ].includes(language) ||
    /\.(?:blade\.php|php|html|vue|jsx?|tsx?|css|scss|json|md)$/.test(lowerPath);
  if (!supported) {
    return null;
  }
  const { default: prettier } = await import("prettier/standalone");

  if (
    language === "php" ||
    (lowerPath.endsWith(".php") && !lowerPath.endsWith(".blade.php"))
  ) {
    const { default: php } = await import("@prettier/plugin-php/standalone");
    return prettier.format(content, {
      parser: "php",
      plugins: [php],
      phpVersion: "8.5",
      printWidth: 120,
      tabWidth: 4,
      semi: true,
      trailingComma: "all",
      singleQuote: false,
    });
  }

  if (
    language === "html" ||
    lowerPath.endsWith(".html") ||
    lowerPath.endsWith(".blade.php") ||
    lowerPath.endsWith(".vue")
  ) {
    const [
      { default: html },
      { default: babel },
      { default: estree },
      { default: typescript },
      { default: postcss },
    ] = await Promise.all([
      import("prettier/plugins/html"),
      import("prettier/plugins/babel"),
      import("prettier/plugins/estree"),
      import("prettier/plugins/typescript"),
      import("prettier/plugins/postcss"),
    ]);
    return prettier.format(content, {
      parser: lowerPath.endsWith(".vue") ? "vue" : "html",
      plugins: [html, babel, estree, typescript, postcss],
      printWidth: 120,
      tabWidth: 2,
      semi: true,
      trailingComma: "all",
      singleQuote: false,
      htmlWhitespaceSensitivity: "css",
    });
  }

  if (
    language === "javascript" ||
    language === "javascriptreact" ||
    lowerPath.endsWith(".js") ||
    lowerPath.endsWith(".jsx")
  ) {
    const [{ default: babel }, { default: estree }] = await Promise.all([
      import("prettier/plugins/babel"),
      import("prettier/plugins/estree"),
    ]);
    return prettier.format(content, {
      parser: "babel",
      plugins: [babel, estree],
      printWidth: 80,
      tabWidth: 2,
      semi: true,
      trailingComma: "all",
      singleQuote: false,
      arrowParens: "always",
    });
  }

  if (
    language === "typescript" ||
    language === "typescriptreact" ||
    lowerPath.endsWith(".ts") ||
    lowerPath.endsWith(".tsx")
  ) {
    const [{ default: typescript }, { default: estree }] = await Promise.all([
      import("prettier/plugins/typescript"),
      import("prettier/plugins/estree"),
    ]);
    return prettier.format(content, {
      parser: "typescript",
      plugins: [typescript, estree],
      printWidth: 80,
      tabWidth: 2,
      semi: true,
      trailingComma: "all",
      singleQuote: false,
      arrowParens: "always",
    });
  }

  if (
    language === "css" ||
    language === "scss" ||
    lowerPath.endsWith(".css") ||
    lowerPath.endsWith(".scss")
  ) {
    const { default: postcss } = await import("prettier/plugins/postcss");
    return prettier.format(content, {
      parser:
        language === "scss" || lowerPath.endsWith(".scss") ? "scss" : "css",
      plugins: [postcss],
      printWidth: 80,
      tabWidth: 2,
      semi: true,
      singleQuote: false,
    });
  }

  if (language === "json" || lowerPath.endsWith(".json")) {
    const [{ default: babel }, { default: estree }] = await Promise.all([
      import("prettier/plugins/babel"),
      import("prettier/plugins/estree"),
    ]);
    return prettier.format(content, {
      parser: "json",
      plugins: [babel, estree],
      printWidth: 80,
      tabWidth: 2,
      trailingComma: "none",
    });
  }

  if (language === "markdown" || lowerPath.endsWith(".md")) {
    const { default: markdown } = await import("prettier/plugins/markdown");
    return prettier.format(content, {
      parser: "markdown",
      plugins: [markdown],
      printWidth: 80,
      tabWidth: 2,
    });
  }

  return null;
};
