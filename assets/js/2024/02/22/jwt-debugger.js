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
const token = 'eyJhbGciOiJIUzI1NiJ9.eyJpYXQiOjE3MDg2NzYxNjYsIm5iZiI6MTcwODY3NjE2NiwiZXhwIjoxNzA4Njc5NzY2LCJzdWIiOiIyIiwidXNlcklkIjoiMDEwLTQxODQtODkwNiIsImF1dGhvcml0aWVzIjpbIk9XTkVSIl19.Ukw-No_lC7GCpmFSRDfo528kUd5MKjjNetjKyZwg3JQ';

// JWT 디코딩 실행
const decodedToken = decodeJWT(token);

// 디코딩된 토큰을 이용하여 추가적인 작업 수행
if (decodedToken) {
    // 예: 유저 정보 활용
    const userId = decodedToken.payload.sub;
    console.log('User ID:', userId);
}

function decode(token) {
    const [header, payload, signature] = token.split('.');

    // Base64 디코딩 후 JSON 파싱
    const decodedHeader = JSON.parse(atob(header));
    const decodedPayload = JSON.parse(atob(payload));

    return { header: decodedHeader, payload: decodedPayload };
}

function dateFormat(date) {
    let month = date.getMonth() + 1;
    let day = date.getDate();
    let hour = date.getHours();
    let minute = date.getMinutes();
    let second = date.getSeconds();
  
    month = month >= 10 ? month : '0' + month;
    day = day >= 10 ? day : '0' + day;
    hour = hour >= 10 ? hour : '0' + hour;
    minute = minute >= 10 ? minute : '0' + minute;
    second = second >= 10 ? second : '0' + second;
  
    return date.getFullYear() + '-' + month + '-' + day + ' ' + hour + ':' + minute + ':' + second;
}

function decodeAndDisplay() {
    // 입력된 JWT 토큰 가져오기
    const token = document.getElementById('target').value;

    console.log('token > ', token)
    if (token && token.length > 0) {
        // JWT 디코딩 실행
        const decodedToken = decode(token);
    
        // 디코딩된 내용을 화면에 출력
        document.getElementById('header').value = JSON.stringify(decodedToken.header, null, 2);
        document.getElementById('payload').value = JSON.stringify(decodedToken.payload, null, 2);
        // Signature는 일반적으로 검증용이므로 여기에 직접 출력하지 않음

        // 추가로 Subject, Issued At, Not Valid Before At, Expiration Time 표시
        document.getElementById('sub').textContent = decodedToken.payload.sub || 'N/A';
        document.getElementById('iat').textContent = decodedToken.payload.iat ? dateFormat(new Date(decodedToken.payload.iat * 1000)) : 'N/A';
        document.getElementById('nbf').textContent = decodedToken.payload.nbf ? dateFormat(new Date(decodedToken.payload.nbf * 1000)) : 'N/A';
        document.getElementById('exp').textContent = decodedToken.payload.exp ? dateFormat(new Date(decodedToken.payload.exp * 1000)) : 'N/A';
    }
}

// keyup 이벤트에 대한 리스너 추가
document.getElementById('target').addEventListener('keyup', decodeAndDisplay);