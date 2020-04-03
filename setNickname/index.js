
/**************************************************
  功能：该函数用于设置用户昵称
*/

const mysql = require('mysql');
const tools = require('./tools')
const queryParse = require('querystring')
const jwt = require('jsonwebtoken')

const privateKey = "";//json-web-token的密钥，不能泄露
const tableInfo = "info";//用户信息表

exports.main_handler = async (event, context, callback) => {
  let queryString = {};
  if(event.httpMethod === "POST") {//post形式
    queryString = queryParse.parse(event.body)
  } else {//get形式
    queryString = event.queryString
  }
  console.log("queryString", queryString)
  if(!queryString || !queryString.userId || !queryString.token || !queryString.name) {
    return {
        errorCode: -1001,
        errorMessage: "缺少参数"
    }
  }
  const connection = mysql.createConnection({
    host: '', // The ip address of cloud database instance, 云数据库实例ip地址
    user: '', // The name of cloud database, for example, root, 云数据库用户名，如root
    password: '', // Password of cloud database, 云数据库密码
    database: '' // Name of the cloud database, 数据库名称
  });

  connection.connect();

  const queryInfoSql = `select * from info where userId = ?`
  let queryInfoReult = await wrapPromise(connection, queryInfoSql, [queryString.userId])
  
  connection.end();
  if(queryInfoReult.length === 0) {//没有找到记录，未登录
    return {
      errorCode: -1202,
      errorMessage: "该手机号尚未注册"
    }
  } else {
    let infoResult = queryInfoReult[0]
    try {
      const decoded = jwt.verify(queryString.token, privateKey)
      if(decoded.phone === infoResult.phone) {
        const updateSql = tools.updateQuery(tableInfo, {name: queryString.name}, {userId: queryString.userId});
        await wrapPromise(connection, updateSql.queryStr, updateSql.queryArr)//更新用户名信息
        return {
          errorCode: 0,
          errorMessage: "设置用户名成功"
        }
      } else {
        return {
          errorCode: -1007,
          errorMessage: "手机号与token不匹配"
        }
      }
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
  }
}

function wrapPromise(connection, sql, args = []) {
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