function decodeJWT(token) {
    const [header, payload, signature] = token.split('.');

    // Base64 디코딩 후 JSON 파싱
    const decodedHeader = JSON.parse(atob(header));
    const decodedPayload = JSON.parse(atob(payload));

    // 결과 출력
    console.log('Decoded Header:', decodedHeader);
    console.log('Decoded Payload:', decodedPayload);

    return { header: decodedHeader, payload: decodedPayload };
}

// 테스트용 JWT 토큰
const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

// JWT 디코딩 실행
const decodedToken = decodeJWT(token);

// 디코딩된 토큰을 이용하여 추가적인 작업 수행
if (decodedToken) {
    // 예: 유저 정보 활용
    const userId = decodedToken.payload.sub;
    console.log('User ID:', userId);
}
