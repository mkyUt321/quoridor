const ADJ = ['すばやい', 'しずかな', 'ふかい', 'あかるい', 'みどりの', 'こはくの', 'とおい', 'しろい', 'はやい', 'ゆうき'];
const NOUN = ['きつね', 'たぬき', 'ふくろう', 'かわせみ', 'こま', 'かべ', 'みち', 'いし', 'つき', 'かぜ'];
const STORAGE_KEY = 'q_nick';

function pick(list: string[]): string {
  return list[Math.floor(Math.random() * list.length)] ?? list[0]!;
}

export function loadNickname(): string {
  return localStorage.getItem(STORAGE_KEY) ?? pick(ADJ) + pick(NOUN);
}

export function saveNickname(nick: string): void {
  localStorage.setItem(STORAGE_KEY, nick);
}
