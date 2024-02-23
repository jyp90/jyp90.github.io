// Unix timestamp (in seconds)
const unixTimestamp = 1645672800; // 예시로 2022-02-24 12:00:00 UTC를 나타냄

// Unix timestamp를 milliseconds로 변환
const milliseconds = unixTimestamp * 1000;

// Date 객체 생성
const date = new Date(milliseconds);

// Date 객체를 사용하여 LocalDateTime으로 변환 (Asia/Seoul 시간대)
const localDateTime = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));

// DateTimeFormatter를 사용하여 LocalDateTime을 원하는 포맷으로 변환
const options = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
};

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

function convert() {
  // name="unix"에 입력된 Unix Timestamp 가져오기
  var unixTimestamp = document.getElementById('unix').value;

  // Unix timestamp를 milliseconds로 변환
  var milliseconds = unixTimestamp * 1000;

  // Date 객체 생성
  var date = new Date(milliseconds);

  // 결과를 name="result"에 출력
  var resultOutput = document.getElementById('result');
  resultOutput.value = dateFormat(date)
}