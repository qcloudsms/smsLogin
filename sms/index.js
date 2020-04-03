
/**************************************************
Node8.9

功能：1.发送短信 2.登录（校验短信验证码、生成用户信息）
***************************************************/
'use strict';
const mysql = require('mysql');
const tools = require('./tools')
const jwt = require('jsonwebtoken')
const queryParse = require('querystring')
const tableInfo = "info";//用户信息表

const cacheCode = {}
const expireTime = 5 * 60 * 1000;//验证码有效期5分钟
const tokenExpireTime = 30 * 24 * 60 * 60;//token过期时间 30天
const privateKey = "";//json-web-token的密钥，不能泄露

//用户头像地址
const ImgUrl = [
  'https://imgcache.qq.com/qcloud/public/static//avatar0_100.20191230.png',
  'https://imgcache.qq.com/qcloud/public/static//avatar1_100.20191230.png',
  'https://imgcache.qq.com/qcloud/public/static//avatar2_100.20191230.png',
  'https://imgcache.qq.com/qcloud/public/static//avatar3_100.20191230.png',
  'https://imgcache.qq.com/qcloud/public/static//avatar4_100.20191230.png',
  'https://imgcache.qq.com/qcloud/public/static//avatar5_100.20191230.png',
  'https://imgcache.qq.com/qcloud/public/static//avatar6_100.20191230.png',
  'https://imgcache.qq.com/qcloud/public/static//avatar7_100.20191230.png',
  'https://imgcache.qq.com/qcloud/public/static//avatar8_100.20191230.png',
  'https://imgcache.qq.com/qcloud/public/static//avatar9_100.20191230.png'
]
exports.main_handler = async (event, context, callback) => {
  let queryString = {};
  if(event.httpMethod === "POST") {//post形式,content-type:application/x-www-form-urlencoded
    queryString = queryParse.parse(event.body)
  } else {//get形式
    queryString = event.queryString
  }
  
  console.log("queryString", queryString)
  if(!queryString || !queryString.method || !queryString.phone) {
    return {
      errorCode: -1001,
      errorMessage: "缺少参数"
    }
  }
  if(!(/^1(3|4|5|6|7|8|9)\d{9}$/.test(queryString.phone))) { 
    return {
        errorCode: -1002,
        errorMessage: "手机号格式不对"
    }
  }
  
  if(queryString.method === "getSms") {//发送短信验证码
    return await getSms(queryString)
  } else if(queryString.method === "login") {//校验验证码登录
    return await loginSms(queryString)
  } else {
    return {
      errorCode: -1004,
      errorMessage: "方法名不存在"
    }
  }
}
/*
* 功能：利用json web token签发一个token
*/
function getToken(userId, infoResult) {
  return jwt.sign({
    phone: infoResult.phone,
    userId: userId,
    name: infoResult.name,
    avatar: infoResult.avatar
  }, privateKey, {expiresIn: tokenExpireTime});
}
/*
* 功能：登录
*/
async function loginSms(queryString) {
  const connection = mysql.createConnection({
    host: '', // The ip address of cloud database instance, 云数据库实例ip地址
    user: '', // The name of cloud database, for example, root, 云数据库用户名，如root
    password: '', // Password of cloud database, 云数据库密码
    database: '' // Name of the cloud database, 数据库名称
  });
  connection.connect();

  if(queryString.token) {
    return await verifyToken(connection, queryString)
  }

  if(!queryString.code || !queryString.sessionId) {
    return {
        errorCode: -1001,
        errorMessage: "缺少参数"
    }
  }

  let result = cacheCode[queryString.phone]
  if(!result || result.used === 2 || result.num >= 3) {
    return {
      errorCode: -1100,
      errorMessage: "验证码已失效"
    }
  }
  if(result.sessionId !== queryString.sessionId) {
    return {
      errorCode: -1103,
      errorMessage: "sessionId不匹配"
    }
  }
  
  if(result.code == queryString.code) {
    cacheCode[queryString.phone].used = 2;//将验证码更新为已使用
    const queryInfoSql = `select * from info where phone = ?`
    let queryInfoResult = await wrapPromise(connection, queryInfoSql, [queryString.phone])
    if(queryInfoResult.length === 0) {//没有找到记录，未注册
      return await generateInfo(connection, queryString)
    } else {
      let infoResult = queryInfoResult[0]
      return {
        errorCode: 0,
        errorMessage: "登录成功",
        data: {
          phone: infoResult.phone,
          token: getToken(infoResult.userId, infoResult),
          name: infoResult.name,
          avatar: infoResult.avatar,
          userId: infoResult.userId.toString()
        }
      }
    }
  } else {
    updateCacheCode(queryString.phone, result)
    return {
      errorCode: -1102,
      errorMessage: "验证码错误，请重新输入"
    }
  }
}
/*
 * 功能：校验token是否有效
 */
async function verifyToken(connection, queryString) {
  let decoded = {}
  try {
    decoded = jwt.verify(queryString.token, privateKey)
  } catch(err) {
    if(err.name === "TokenExpiredError") {
      return {
        errorCode: -1006,
        errorMessage: "token已过期，输入短信验证码重新登录"
      }
    } else {
      return {
        errorCode: -1005,
        errorMessage: "token错误，输入短信验证码重新登录"
      }
    }
  }
  if(decoded.phone === queryString.phone) {
    //用户名可能更新，这里查一下db
    const queryInfoSql = `select * from info where phone = ?`
    let queryInfoResult = await wrapPromise(connection, queryInfoSql, [queryString.phone])
    let infoResult = queryInfoResult[0]
    return {
      errorCode: 0,
      errorMessage: "登录成功",
      data: {
        userId: infoResult.userId.toString(),
        token: queryString.token,
        phone: infoResult.phone,
        name: infoResult.name,
        avatar: infoResult.avatar
      }
    }
  } else {
    return {
      errorCode: -1007,
      errorMessage: "手机号与token不匹配"
    }
  }
}
//清理过期的验证码数据
function clearCacheCode() {
  const nowTime = new Date().getTime();
  for(let index in cacheCode) {
    if(nowTime - cacheCode[index].sendTime > expireTime) {//验证码已过期
        delete cacheCode[index]
    }
  }
}
/*
 * 功能：根据手机号获取短信验证码
 */
async function getSms(queryString) {
  const code = Math.random().toString().slice(-6);//生成6位数随机验证码
  const sessionId = Math.random().toString().slice(-8);//生成8位随机数
  const sessionCode = {
      code: code,
      sessionId: sessionId,
      sendTime: new Date().getTime(),
      num: 0,//验证次数，最多可验证3次
      used: 1//1-未使用，2-已使用
  }
  clearCacheCode()

  cacheCode[queryString.phone] = sessionCode

  let queryResult = await sendSms(queryString.phone, code)
  queryResult.data.sessionId = sessionId;//随机8位id
  return queryResult
}
/*
 * 功能：通过sdk调用短信api发送短信
 * 参数 手机号、短信验证码
 */
async function sendSms(phone, code) {
  const tencentcloud = require('tencentcloud-sdk-nodejs');
  const SmsClient = tencentcloud.sms.v20190711.Client;
  const Credential = tencentcloud.common.Credential;
  const ClientProfile = tencentcloud.common.ClientProfile;
  const HttpProfile = tencentcloud.common.HttpProfile;
  //腾讯云账户secretId，secretKey，不能泄露
  const secretId = "secretId";//这里需要真实的secretId
  const secretKey = "secretKey";//这里需要真实的secretKey

  let cred = new Credential(secretId, secretKey);
  let httpProfile = new HttpProfile();
  httpProfile.endpoint = "sms.tencentcloudapi.com";
  let clientProfile = new ClientProfile();
  clientProfile.httpProfile = httpProfile;
  let client = new SmsClient(cred, "ap-guangzhou", clientProfile);
  phone = "+86" + phone;//国内手机号

  let req = {
      PhoneNumberSet: [phone],//发送短信的手机号
      TemplateID: "",//短信控制台创建的模板id
      Sign: "",//短信控制台创建的签名
      TemplateParamSet: [code],//随机验证码
      SmsSdkAppid: ""//短信应用id
  }
  
  function smsPromise() {
      return new Promise((resolve, reject) => {
          client.SendSms(req, function(errMsg, response) {
              if (errMsg) {
                  reject(errMsg)
              } else {
                  if(response.SendStatusSet && response.SendStatusSet[0] && response.SendStatusSet[0].Code === "Ok") {
                      resolve({
                          errorCode: 0,
                          errorMessage: response.SendStatusSet[0].Message,
                          data: {
                              codeStr: response.SendStatusSet[0].Code,
                              requestId: response.RequestId
                          }
                      })
                  } else {
                      resolve({
                          errorCode: -1003,//短信验证码发送失败
                          errorMessage: response.SendStatusSet[0].Message,
                          data: {
                              codeStr: response.SendStatusSet[0].Code,
                              requestId: response.RequestId
                          }
                          
                      })
                  }
              }                
          });
      })
  }
  let queryResult = await smsPromise()
  return queryResult
}

function updateCacheCode(phone, result) {
  if(cacheCode[phone]) {
    cacheCode[phone].num = ++result.num//验证次数，最多可验证3次
  }
}
/*
 * 功能：生成用户id，头像等信息存入db
 */
async function generateInfo(connection, queryString) {
  let randomNum = Math.floor(Math.random() * ImgUrl.length);//生成头像地址的随机数
  let params = {
    phone: queryString.phone,
    name: "",//用户名
    avatar: ImgUrl[randomNum],//随机头像地址
    time: new Date().getTime() //当前时间
  }
  const insertInfoSql = tools.insertQuery(tableInfo, params)
  let inserInfoResult = await wrapPromise(connection, insertInfoSql.queryStr, insertInfoSql.queryArr)
  if(inserInfoResult && inserInfoResult.insertId) {
    return {
      errorCode: 0,
      errorMessage: "登录成功",
      data: {
        userId: inserInfoResult.insertId.toString(),
        token: getToken(inserInfoResult.insertId, params),
        phone: params.phone,
        name: params.name,
        avatar: params.avatar
      }
    }
  } else {
      return {
        errorCode: -1201,
        errorMessage: "登录失败，用户信息设置失败"
      }
  }
}
async function wrapPromise(connection, sql, args = []) {
  const sqlStr = mysql.format(sql, args);
  return new Promise((res, rej) => {
      connection.query(sqlStr, function(error, results, fields) {
          if (error) {
              rej(error)
          }
          res(results)
      })
  })
}
