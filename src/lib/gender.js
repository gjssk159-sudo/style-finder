// 상품명/원본카테고리에서 성별 추출. 데이터가 명시적으로 말해주는 경우만 잡고(예: 카테고리가 "FEMALE",
// 제목에 "WOMEN"/"여성"), 애매하면 null(미상)로 둠 — 없는 신호를 억지로 추측하지 않음.
// 영문 단어는 앞뒤 경계를 요구해서 "HUMANITY"/"GERMANY"/"WOMAN" 안의 "MAN" 같은 오검출을 막음
// (예: "female" 안의 "male"도 boundary 때문에 안 걸림).

const WOMEN_WORDS = ['women', 'woman', 'female', 'ladies', 'lady', 'womenswear', '여성', '여자', '우먼', '워먼', '레이디스', '레이디'];
const MEN_WORDS = ['men', 'man', 'male', 'menswear', "man's", '남성', '남자', '맨즈', '멘즈'];
const UNISEX_WORDS = ['unisex', '유니섹스', '남녀공용', '공용'];

function hasWord(hay, word) {
  if (/^[a-z']+$/i.test(word)) {
    const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![a-z])${esc}(?![a-z])`, 'i').test(hay);
  }
  return hay.includes(word);
}

export function classifyGender(...texts) {
  // "남자친구"(boyfriend)/"여자친구"(girlfriend) 같은 표현이 review 텍스트 등에 섞여 들어오면
  // "남자"/"여자" 부분 문자열 매칭에 오검출되므로 먼저 제거.
  const hay = texts.filter(Boolean).join(' ').replace(/[남여]자\s*친구|[남여]친/g, '');
  if (!hay.trim()) return null;
  if (UNISEX_WORDS.some((w) => hasWord(hay, w))) return 'unisex';
  const isWomen = WOMEN_WORDS.some((w) => hasWord(hay, w));
  const isMen = MEN_WORDS.some((w) => hasWord(hay, w));
  if (isWomen && isMen) return 'unisex';
  if (isWomen) return 'women';
  if (isMen) return 'men';
  return null;
}
