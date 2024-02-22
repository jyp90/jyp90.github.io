// json-prettier.js

function prettifyJSON() {
    // textarea에서 내용 가져오기
    var rawJson = document.getElementById('target').value;

    try {
        if (rawJson.length > 0) {
            // JSON 파싱 시도
            var parsedJson = JSON.parse(rawJson);
    
            // Prettier 적용하여 다시 문자열로 변환
            var prettyJson = JSON.stringify(parsedJson, null, 2);
    
            // 결과를 textarea에 적용
            document.getElementById('target').value = prettyJson;
        }
    } catch (error) {
        alert('유효한 JSON 형식이 아닙니다.');
        console.error(error);
    }
}

// 문서가 로드되면 바로 실행
prettifyJSON();
