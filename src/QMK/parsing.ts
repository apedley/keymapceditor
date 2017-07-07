interface AstWord {
    type: "word";
    content: string;
    offset: number;
    end: number;
}

interface AstFunction {
    type: "func";
    func: string;
    params: AstNode[];
    offset: number;
    end: number;
    content: string;
}

type AstNode = AstWord | AstFunction;

export type KeymapParseResult = AstNode[][];

export const tryParseKeymapsText = (
    expr: string,
    keyCount: number | null = null,
    _returnOnlyEndHack: boolean = false
): KeymapParseResult => {
    let pos = 0;
    let keymaps: AstNode[][] = [];

    const tokenWithoutSpaces = (s: string): [number, string] => {
        let start = 0;
        let end = s.length;
        let leadingSpaces = /^\s+/.exec(s);
        start += (leadingSpaces && leadingSpaces[0].length) || 0;

        let trailingSpaces = /\s+$/.exec(s);
        end -= (trailingSpaces && trailingSpaces[0].length) || 0;

        return [start, s.slice(start, end)];
    };

    while (expr.indexOf("KEYMAP(", pos) !== -1) {
        pos = expr.indexOf("KEYMAP(", pos);
        pos += 7; // "KEYMAP("
        let pcount = 1; // First parenthesis of KEYMAP(
        const main = (start: number) => {
            let arr: AstNode[] = [];
            let lastToken = -1;

            let ensureTokenExists = () => {
                if (lastToken === arr.length || arr.length === 0) {
                    throw new Error("Missing token at: " + pos);
                }
                lastToken = arr.length;
            };

            let addWord = (end: number) => {
                if (end <= start) {
                    return false;
                }
                let [offset, token] = tokenWithoutSpaces(expr.slice(start, end));
                if (token === "") {
                    return false;
                }
                if (/\s/.test(token)) {
                    throw new Error("Whitespaces are not allowed at: " + (start + offset));
                }
                arr.push(
                    {
                        type: "word",
                        content: token,
                        offset: start + offset,
                        end: end, // end includes the whitespace
                    } as AstWord
                );
                return true;
            };

            let addFunc = (end: number) => {
                if (end <= start) {
                    throw new Error("Function name required at: " + end);
                }
                let [offset, token] = tokenWithoutSpaces(expr.slice(start, end));
                if (token === "") {
                    throw new Error("Function name required at: " + (start + offset));
                }
                if (/\s/.test(token)) {
                    throw new Error(
                        "Function name can't have spaces, parse error at: " + (start + offset)
                    );
                }
                let params = main(end + 1);
                let paramsend = params.slice(-1)[0].end;
                arr.push(
                    {
                        type: "func",
                        func: token,
                        params: params,
                        offset: start + offset,
                        end: paramsend + 1, // + 1 for the ending parenthesis
                        content: expr.slice(start + offset, paramsend + 1),
                    } as AstFunction
                );
                return true;
            };

            while (pos < expr.length) {
                let char = expr[pos++];
                let next = expr[pos];
                switch (char + next) {
                    case "\\\n":
                        pos++;
                        start = pos;
                        break;
                    case "/*":
                        addWord(pos - 1);
                        while (pos < expr.length) {
                            let char = expr[pos++];
                            let next = expr[pos];
                            if (char + next === "*/") {
                                pos++;
                                start = pos;
                                break;
                            }
                        }
                        break;
                    case "//":
                        addWord(pos - 1);
                        while (pos < expr.length) {
                            let char = expr[pos++];
                            let next = expr[pos + 1];
                            if (char === "\n") {
                                pos++;
                                start = pos;
                                break;
                            }
                        }
                        break;
                }
                switch (char) {
                    case " ":
                        continue;
                    case ",":
                        addWord(pos - 1);
                        ensureTokenExists();
                        start = pos;
                        continue;
                    case "(":
                        addFunc(pos - 1);
                        pcount++;
                        start = pos;
                        continue;
                    case ")":
                        addWord(pos - 1);
                        ensureTokenExists();
                        pcount--;
                        return arr;
                }
            }
            return arr;
        };
        let keymap = main(pos);
        if (pcount !== 0) {
            throw new Error("KEYMAP parenthesis unbalanced");
        }
        keymaps.push(keymap);
    }
    if (keymaps.length >= 1) {
        if (keymaps.some(t => t.length !== keymaps[0].length)) {
            throw new Error("Incompatible amount of keys in layers");
        }
        if (keyCount !== null && keymaps[0].length !== keyCount) {
            throw new Error(
                "Number of keys in KEYMAP are incorrect for this layout: " +
                    keymaps[0].length +
                    " expected: " +
                    keyCount
            );
        }
    } else if (keymaps.length === 0) {
        throw new Error("KEYMAPS not found");
    }
    if (_returnOnlyEndHack) {
        (keymaps as any)._endParsingPosition = pos;
    }
    return keymaps;
};

/**
 * Returns the new keymapText with key set on to a newValue.
 * 
 * Throws an parsing error if the new value cannot be set. 
 * 
 * @param keymapText KeymapText value to modify
 * @param layer Layer number
 * @param key Selected key
 * @param newValue Value to set at the key
 * @param keyCount Expected key count of the layout, for parsing
 */
export const trySetKeymapsKey = (
    keymapText: string,
    layer: number,
    key: number,
    newValue: string,
    keyCount: number = null
) => {
    let keymapParsed = tryParseKeymapsText(keymapText, keyCount);
    let layerKeys = keymapParsed[layer];
    if (!layerKeys) {
        return keymapText;
    }

    let keyValue = layerKeys[key];
    if (typeof keyValue === "undefined") {
        return keymapText;
    }

    let head = keymapText.substr(0, keyValue.offset);
    let tail = keymapText.substr(keyValue.offset + keyValue.content.length);
    let newKeymap = head + newValue + tail;
    tryParseKeymapsText(newKeymap, keyCount);
    return newKeymap;
};

export const addLayerKeymaps = (keymapText: string) => {
    try {
        var keymaps = tryParseKeymapsText(keymapText, null, true);
    } catch (e) {
        return keymapText;
    }
    let pos: number = (keymaps as any)._endParsingPosition;
    let n = keymaps.length;
    let empties = keymaps[0].map(t => "KC_TRANSPARENT");
    return (
        keymapText.substr(0, pos) +
        ",\n [" +
        n +
        "] = KEYMAP(" +
        empties.join(",") +
        ")" +
        keymapText.substr(pos)
    );
};

export interface Executor<T> {
    [k: string]: () => T | string | null;
}

export const evalKeyExpression = <T>(expr: AstNode | string, executor: Executor<T>): T => {
    if (expr !== null) {
        if (typeof expr === "string") {
            return expr as any;
        } else if (expr.type === "word") {
            return expr.content as any;
        } else if (expr.type === "func") {
            let evaledParams = [];
            expr.params.forEach(t => {
                evaledParams.push(evalKeyExpression(t, executor));
            });
            if (expr.func in executor) {
                return executor[expr.func].apply(null, evaledParams) || null;
            } else {
                return null;
            }
        } else {
            return null;
        }
    }
    return null;
};