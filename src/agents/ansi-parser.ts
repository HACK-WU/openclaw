/**
 * ANSI 转义序列解析器
 *
 * 维护一个虚拟终端缓冲区，正确解析光标移动、清除等控制码，
 * 将 PTY 输出转换为纯文本状态快照。
 */

const ESC = "\x1b";
const CSI = `${ESC}[`;

/**
 * 虚拟终端缓冲区
 * 维护当前屏幕状态和光标位置
 */
export class VirtualTerminal {
  private buffer: string[][] = [];
  private cursorX = 0;
  private cursorY = 0;
  private cols: number;
  private rows: number;
  private scrollTop = 0;
  private scrollBottom: number;

  constructor(cols = 80, rows = 24) {
    this.cols = cols;
    this.rows = rows;
    this.scrollBottom = rows - 1;
    this.initializeBuffer();
  }

  private initializeBuffer() {
    for (let i = 0; i < this.rows; i++) {
      this.buffer.push(Array.from({ length: this.cols }, () => ""));
    }
  }

  /**
   * 写入数据并解析 ANSI 控制码
   */
  write(data: string): void {
    let i = 0;
    while (i < data.length) {
      const char = data[i];

      if (char === ESC && data[i + 1] === "[") {
        // CSI 序列
        const result = this.parseCsi(data.slice(i));
        if (result.length > 0) {
          this.executeCommand(result);
          i += result.length;
        } else {
          i++;
        }
      } else if (char === ESC) {
        // 其他 ESC 序列（简化处理：跳过）
        i++;
        while (i < data.length && data[i] >= "@" && data[i] <= "~") {
          i++;
          break;
        }
      } else if (char === "\r") {
        this.cursorX = 0;
        i++;
      } else if (char === "\n") {
        this.lineFeed();
        i++;
      } else if (char === "\t") {
        // Tab：移动到下一个 8 列边界
        const nextTabStop = Math.floor(this.cursorX / 8) * 8 + 8;
        this.cursorX = Math.min(nextTabStop, this.cols - 1);
        i++;
      } else if (char === "\b" || char === "\x7f") {
        // Backspace
        if (this.cursorX > 0) {
          this.cursorX--;
        }
        i++;
      } else {
        // 可打印字符
        this.writeChar(char);
        i++;
      }
    }
  }

  /**
   * 解析 CSI 序列
   */
  private parseCsi(data: string): string {
    if (!data.startsWith(CSI)) {
      return "";
    }

    let i = 2; // 跳过 ESC[
    // 解析参数字节 (0x30-0x3F)
    while (i < data.length && data[i] >= "0" && data[i] <= "?") {
      i++;
    }
    // 解析中间字节 (0x20-0x2F)
    while (i < data.length && data[i] >= " " && data[i] <= "/") {
      i++;
    }
    // 最终字节 (0x40-0x7E)
    if (i < data.length && data[i] >= "@" && data[i] <= "~") {
      i++;
    }

    return data.slice(0, i);
  }

  /**
   * 执行 ANSI 命令
   */
  private executeCommand(csi: string): void {
    // 正则匹配 CSI 序列：ESC [ 参数 最终字节
    // 动态构造正则，正确转义特殊字符
    const csiPattern = ESC + "\\["; // ESC + 转义的 [
    const match = csi.match(new RegExp(`^${csiPattern}([0-9;]*)?([@-~])$`));
    if (!match) {
      return;
    }

    const paramsStr = match[1] || "";
    const finalChar = match[2];
    const params = paramsStr.split(";").map((p) => (p === "" ? 0 : Number.parseInt(p, 10)));

    switch (finalChar) {
      case "A": // Cursor Up
        this.cursorUp(params[0] || 1);
        break;
      case "B": // Cursor Down
        this.cursorDown(params[0] || 1);
        break;
      case "C": // Cursor Forward
        this.cursorForward(params[0] || 1);
        break;
      case "D": // Cursor Back
        this.cursorBack(params[0] || 1);
        break;
      case "E": // Cursor Next Line
        this.cursorNextLine(params[0] || 1);
        break;
      case "F": // Cursor Previous Line
        this.cursorPreviousLine(params[0] || 1);
        break;
      case "G": // Cursor Character Absolute
        this.cursorColumn(params[0] || 1);
        break;
      case "H": // Cursor Position
      case "f": // Cursor Position (alternative)
        this.cursorPosition(params[0] || 1, params[1] || 1);
        break;
      case "J": // Erase in Display
        this.eraseDisplay(params[0] || 0);
        break;
      case "K": // Erase in Line
        this.eraseLine(params[0] || 0);
        break;
      case "S": // Scroll Up
        this.scrollUp(params[0] || 1);
        break;
      case "T": // Scroll Down
        this.scrollDown(params[0] || 1);
        break;
    }
  }

  private cursorUp(n: number): void {
    this.cursorY = Math.max(0, this.cursorY - n);
  }

  private cursorDown(n: number): void {
    this.cursorY = Math.min(this.scrollBottom, this.cursorY + n);
  }

  private cursorForward(n: number): void {
    this.cursorX = Math.min(this.cols - 1, this.cursorX + n);
  }

  private cursorBack(n: number): void {
    this.cursorX = Math.max(0, this.cursorX - n);
  }

  private cursorNextLine(n: number): void {
    this.cursorY = Math.min(this.scrollBottom, this.cursorY + n);
    this.cursorX = 0;
  }

  private cursorPreviousLine(n: number): void {
    this.cursorY = Math.max(0, this.cursorY - n);
    this.cursorX = 0;
  }

  private cursorColumn(n: number): void {
    this.cursorX = Math.max(0, Math.min(this.cols - 1, n - 1));
  }

  private cursorPosition(row: number, col: number): void {
    this.cursorY = Math.max(0, Math.min(this.scrollBottom, row - 1));
    this.cursorX = Math.max(0, Math.min(this.cols - 1, col - 1));
  }

  private eraseDisplay(mode: number): void {
    switch (mode) {
      case 0: // Clear from cursor to end of screen
        for (let y = this.cursorY; y < this.rows; y++) {
          const startCol = y === this.cursorY ? this.cursorX : 0;
          for (let x = startCol; x < this.cols; x++) {
            this.buffer[y][x] = "";
          }
        }
        break;
      case 1: // Clear from beginning to cursor
        for (let y = 0; y <= this.cursorY; y++) {
          const endCol = y === this.cursorY ? this.cursorX + 1 : this.cols;
          for (let x = 0; x < endCol; x++) {
            this.buffer[y][x] = "";
          }
        }
        break;
      case 2: // Clear entire screen
        for (let y = 0; y < this.rows; y++) {
          for (let x = 0; x < this.cols; x++) {
            this.buffer[y][x] = "";
          }
        }
        this.cursorX = 0;
        this.cursorY = 0;
        break;
    }
  }

  private eraseLine(mode: number): void {
    switch (mode) {
      case 0: // Clear from cursor to end of line
        for (let x = this.cursorX; x < this.cols; x++) {
          this.buffer[this.cursorY][x] = "";
        }
        break;
      case 1: // Clear from beginning to cursor
        for (let x = 0; x <= this.cursorX; x++) {
          this.buffer[this.cursorY][x] = "";
        }
        break;
      case 2: // Clear entire line
        for (let x = 0; x < this.cols; x++) {
          this.buffer[this.cursorY][x] = "";
        }
        this.cursorX = 0;
        break;
    }
  }

  private scrollUp(n: number): void {
    for (let i = 0; i < n; i++) {
      this.buffer.splice(this.scrollTop, 1);
      this.buffer.splice(
        this.scrollBottom,
        0,
        Array.from({ length: this.cols }, () => ""),
      );
    }
  }

  private scrollDown(n: number): void {
    for (let i = 0; i < n; i++) {
      this.buffer.splice(this.scrollBottom, 1);
      this.buffer.splice(
        this.scrollTop,
        0,
        Array.from({ length: this.cols }, () => ""),
      );
    }
  }

  private lineFeed(): void {
    if (this.cursorY < this.scrollBottom) {
      this.cursorY++;
    } else {
      this.scrollUp(1);
    }
  }

  private writeChar(char: string): void {
    if (this.cursorX >= this.cols) {
      // 自动换行
      this.cursorX = 0;
      this.lineFeed();
    }
    this.buffer[this.cursorY][this.cursorX] = char;
    this.cursorX++;
  }

  /**
   * 获取当前终端内容（纯文本）
   * 移除首尾空白行，只保留有效内容区域
   */
  getContent(): string {
    const rows = this.buffer.map((row) => {
      // 移除行尾空白
      let lastNonEmpty = -1;
      for (let i = row.length - 1; i >= 0; i--) {
        if (row[i] !== "") {
          lastNonEmpty = i;
          break;
        }
      }
      return row.slice(0, lastNonEmpty + 1).join("");
    });

    // 移除顶部空白行
    let firstNonEmptyRow = 0;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i] !== "") {
        firstNonEmptyRow = i;
        break;
      }
    }

    // 移除底部空白行
    let lastNonEmptyRow = rows.length - 1;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i] !== "") {
        lastNonEmptyRow = i;
        break;
      }
    }

    return rows.slice(firstNonEmptyRow, lastNonEmptyRow + 1).join("\n");
  }

  /**
   * 重置终端状态
   */
  reset(): void {
    this.buffer = [];
    this.cursorX = 0;
    this.cursorY = 0;
    this.scrollTop = 0;
    this.scrollBottom = this.rows - 1;
    this.initializeBuffer();
  }
}
