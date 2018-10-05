import trimEnd from "lodash/trimEnd";
import tokenTypes from "./tokenTypes";
import Indentation from "./Indentation";
import InlineBlock from "./InlineBlock";
import Params from "./Params";

export default class Formatter {
    /**
     * @param {Object} cfg
     *   @param {Object} cfg.indent
     *   @param {Object} cfg.params
     * @param {Tokenizer} tokenizer
     */
    constructor(cfg, tokenizer) {
        this.cfg = cfg || {};
        this.indentation = new Indentation(this.cfg.indent);
        this.inlineBlock = new InlineBlock();
        this.params = new Params(this.cfg.params);
        this.tokenizer = tokenizer;
        this.previousReservedWord = {};

        this.nextLinePrepend = '';
        this.maxCharacterPerLine = cfg.maxCharacterPerLine || 0;
    }

    /**
     * Formats whitespaces in a SQL string to make it easier to read.
     *
     * @param {String} query The SQL query string
     * @return {String} formatted query
     */
    format(query) {
        const tokens = this.tokenizer.tokenize(query);
        const formattedQuery = this.getFormattedQueryFromTokens(tokens);

        return formattedQuery.trim();
    }

    getFormattedQueryFromTokens(tokens) {
        let formattedQuery = "";

        tokens.forEach((token, index) => {
            if (this.nextLinePrepend.length !== 0 &&
                token.type !== tokenTypes.LINE_COMMENT &&
                token.type !== tokenTypes.BLOCK_COMMENT &&
                token.type !== tokenTypes.WHITESPACE) {

                token.value = this.nextLinePrepend + token.value;
                this.nextLinePrepend = "";
            }

            if (token.type === tokenTypes.WHITESPACE) {
                return;
            }
            else if (token.type === tokenTypes.LINE_COMMENT) {
                formattedQuery = this.formatLineComment(token, formattedQuery);
            }
            else if (token.type === tokenTypes.BLOCK_COMMENT) {
                formattedQuery = this.formatBlockComment(token, formattedQuery);
            }
            else if (token.type === tokenTypes.RESERVED_TOPLEVEL) {
                formattedQuery = this.formatToplevelReservedWord(token, formattedQuery);
                this.previousReservedWord = token;
            }
            else if (token.type === tokenTypes.RESERVED_NEWLINE) {
                formattedQuery = this.formatNewlineReservedWord(token, formattedQuery);
                this.previousReservedWord = token;
            }
            else if (token.type === tokenTypes.RESERVED_NEWLINE_WITH_INDENT) {
                formattedQuery = this.formatNewlineReservedWordWithIndent(token, formattedQuery);
                this.previousReservedWord = token;
            }
            else if (token.type === tokenTypes.RESERVED) {
                formattedQuery = this.checkMaxCharacter(tokens, index, formattedQuery);
                formattedQuery = this.formatWithSpaces(token, formattedQuery);
                this.previousReservedWord = token;
            }
            else if (token.type === tokenTypes.OPEN_PAREN) {
                formattedQuery = this.formatOpeningParentheses(tokens, index, formattedQuery);
            }
            else if (token.type === tokenTypes.CLOSE_PAREN) {
                formattedQuery = this.formatClosingParentheses(token, formattedQuery);
            }
            else if (token.type === tokenTypes.PLACEHOLDER) {
                formattedQuery = this.formatPlaceholder(token, formattedQuery);
            }
            else if (token.value === ",") {
                formattedQuery = this.formatComma(token, formattedQuery);
            }
            else if (token.value === ":") {
                formattedQuery = this.formatWithSpaceAfter(token, formattedQuery);
            }
            else if (token.value === ".") {
                formattedQuery = this.formatWithoutSpaces(token, formattedQuery);
            }
            else if (token.value === ";") {
                formattedQuery = this.formatWithoutSpaces(token, formattedQuery) + "\n\n";
            }
            else {
                formattedQuery = this.checkMaxCharacter(tokens, index, formattedQuery);
                formattedQuery = this.formatWithSpaces(token, formattedQuery);
            }
        });
        return formattedQuery;
    }

    formatLineComment(token, query) {
        this.dropMaxCharacterIndent();
        return this.addNewline(query + token.value.replace('--', '/*').replace('\n','') + ' */');
    }

    checkMaxCharacter(tokens, index, query) {
        const lines = query.split("\n");
        const lastLine = lines[lines.length - 1];
        if (this.maxCharacterPerLine !== 0 &&
            (lastLine.length + tokens[index].value.length > this.maxCharacterPerLine)) {
            this.indentation.increaseMaxCharacterLevel();
            return this.addNewline(query);
        }
        return query;
    }

    dropMaxCharacterIndent() {
        this.indentation.decreaseAllMaxCharacterLevel();
    }

    formatBlockComment(token, query) {
        return this.addNewline(this.addNewline(query) + this.indentComment(token.value));
    }

    indentComment(comment) {
        return comment.replace(/\n/g, "\n" + this.indentation.getIndent());
    }

    formatToplevelReservedWord(token, query) {
        this.dropMaxCharacterIndent();
        this.indentation.decreaseNewLineWithIndentLevel();
        this.indentation.decreaseTopLevel();

        query = this.addNewline(query);

        this.indentation.increaseToplevel();

        query += this.equalizeWhitespace(token.value);
        return this.addNewline(query);
    }

    formatNewlineReservedWord(token, query) {
        this.dropMaxCharacterIndent();
        const dropNewLineWithIndentLevel = [
            "CROSS APPLY", "CROSS JOIN", "INNER JOIN", "JOIN", "LEFT JOIN", "LEFT OUTER JOIN",
            "OUTER APPLY", "OUTER JOIN", "RIGHT JOIN", "RIGHT OUTER JOIN"
        ];
        if (dropNewLineWithIndentLevel.indexOf(token.value.toUpperCase()) !== -1) {
            this.indentation.decreaseNewLineWithIndentLevel();
        }
        return this.addNewline(query) + this.equalizeWhitespace(token.value) + " ";
    }

    formatNewlineReservedWordWithIndent(token, query) {
        this.dropMaxCharacterIndent();
        this.indentation.increaseNewLineWithIndentLevel();
        query = this.addNewline(query);
        query += this.equalizeWhitespace(token.value) + " ";
        return query;
    }

    // Replace any sequence of whitespace characters with single space
    equalizeWhitespace(string) {
        return string.replace(/\s+/g, " ");
    }

    // Opening parentheses increase the block indent level and start a new line
    formatOpeningParentheses(tokens, index, query) {
        this.dropMaxCharacterIndent();
        // Take out the preceding space unless there was whitespace there in the original query or another opening parens
        const previousToken = tokens[index - 1];
        if (previousToken && previousToken.type !== tokenTypes.WHITESPACE && previousToken.type !== tokenTypes.OPEN_PAREN) {
            query = trimEnd(query);
        }

        this.inlineBlock.beginIfPossible(tokens, index);

        if (!this.inlineBlock.isActive()) {
            query = this.addNewline(query);
            query += tokens[index].value;
            this.indentation.increaseBlockLevel();
            query = this.addNewline(query);
        }
        else {
            query += tokens[index].value;
        }
        return query;
    }

    // Closing parentheses decrease the block indent level
    formatClosingParentheses(token, query) {
        if (this.inlineBlock.isActive()) {
            this.inlineBlock.end();
            return this.formatWithSpaceAfter(token, query);
        }
        else {
            this.indentation.decreaseBlockLevel();
            return this.formatWithSpaces(token, this.addNewline(query));
        }
    }

    formatPlaceholder(token, query) {
        return query + this.params.get(token) + " ";
    }

    // Commas start a new line (unless within inline parentheses or SQL "LIMIT" clause)
    formatComma(token, query) {
        this.dropMaxCharacterIndent();
        if (this.inlineBlock.isActive() || (/^LIMIT$/i).test(this.previousReservedWord.value)) {
            query = trimEnd(query) + token.value + " ";
            return query;
        }
        else {
            query = trimEnd(query) + " ";
            this.nextLinePrepend = token.value;
            return this.addNewline(query);
        }
    }

    formatWithSpaceAfter(token, query) {
        return trimEnd(query) + token.value + " ";
    }

    formatWithoutSpaces(token, query) {
        return trimEnd(query) + token.value;
    }

    formatWithSpaces(token, query) {
        return query + token.value + " ";
    }

    addNewline(query) {
        return trimEnd(query) + "\n" + this.indentation.getIndent();
    }
}
