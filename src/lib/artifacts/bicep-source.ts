// Bicep 소스를 문자열과 주석 경계에 맞춰 한 번 훑는다.
// 정규식 검사가 주석(토큰 사이에 끼워도 Bicep은 공백으로 본다)이나 문자열 안의 글자에 속지 않게 하려는 용도다.

export type BicepSource = {
  /** 주석마다 공백 한 칸으로 바꾼 코드. 문자열은 그대로 둔다. */
  code: string;
  /** code와 길이가 같고, 문자열 안의 글자(바깥 따옴표 제외)를 공백으로 가린 코드. 줄바꿈은 남긴다. */
  mask: string;
  /** 닫히지 않은 문자열, 주석, 보간이 있으면 true. */
  unterminated: boolean;
};

type Frame = { kind: "code"; braces: number; interpolation: boolean } | { kind: "string" };

export function scanBicep(source: string): BicepSource {
  const frames: Frame[] = [{ kind: "code", braces: 0, interpolation: false }];
  const code: string[] = [];
  const mask: string[] = [];
  let strings = 0;
  let index = 0;
  let unterminated = false;

  const emit = (text: string) => {
    code.push(text);
    mask.push(strings > 0 ? text.replace(/[^\r\n]/g, " ") : text);
  };
  const closeString = () => {
    frames.pop();
    strings--;
  };

  while (index < source.length) {
    const frame = frames[frames.length - 1];
    const char = source[index];
    const next = source[index + 1];

    // '...' 문자열: \ 다음 한 글자는 이스케이프, ${ 는 보간 시작. 줄바꿈을 넘을 수 없다.
    if (frame.kind === "string") {
      if (char === "\r" || char === "\n") {
        closeString();
        unterminated = true;
      } else if (char === "'") {
        closeString();
        emit(char);
        index++;
      } else if (char === "\\" && next !== undefined && next !== "\r" && next !== "\n") {
        emit(char + next);
        index += 2;
      } else if (char === "$" && next === "{") {
        emit("${");
        frames.push({ kind: "code", braces: 0, interpolation: true });
        index += 2;
      } else {
        emit(char);
        index++;
      }
      continue;
    }

    if (char === "/" && next === "/") {
      let end = index + 2;
      while (end < source.length && source[end] !== "\n" && source[end] !== "\r") end++;
      emit(" ");
      index = end;
      continue;
    }
    // 여러 줄 주석은 Bicep에서 줄바꿈 토큰이 아니므로 줄바꿈 없이 공백 한 칸으로 바꾼다.
    if (char === "/" && next === "*") {
      const end = source.indexOf("*/", index + 2);
      emit(" ");
      if (end < 0) {
        unterminated = true;
        break;
      }
      index = end + 2;
      continue;
    }
    // '''...''' 문자열: 이스케이프와 보간이 없다. 닫는 ''' 뒤에 이어지는 ' 도 내용에 포함된다.
    if (source.startsWith("'''", index)) {
      emit("'''");
      const end = source.indexOf("'''", index + 3);
      const close = end < 0 ? source.length : end + 3 + (source.slice(end + 3).match(/^'*/)?.[0].length ?? 0);
      strings++;
      emit(source.slice(index + 3, end < 0 ? close : close - 3));
      strings--;
      if (end < 0) {
        unterminated = true;
        break;
      }
      emit("'''");
      index = close;
      continue;
    }
    if (char === "'") {
      emit(char);
      frames.push({ kind: "string" });
      strings++;
      index++;
      continue;
    }
    if (frame.interpolation && char === "{") frame.braces++;
    if (frame.interpolation && char === "}") {
      if (frame.braces === 0) frames.pop();
      else frame.braces--;
    }
    emit(char);
    index++;
  }

  if (frames.length > 1) unterminated = true;
  return { code: code.join(""), mask: mask.join(""), unterminated };
}
