module.exports = {
	isObject(objLike) {
		return Object.prototype.toString.call(objLike) === '[object Object]';
	},
	isArray(objLike) {
		return Object.prototype.toString.call(objLike) === '[object Array]';
	},
	isEmptyObj(objLike) {
		return !(this.isObject(objLike) && Object.keys(objLike).length > 0);
	},

	/**
	 * 过滤无值参数
	 * @param obj query查找参数
	 */
	filterMap(obj) {
		let temp = {}
		Object.keys(obj).forEach(key => {
			if(obj[key] !== undefined && obj[key] !== null && obj[key] !== "") temp[key] = obj[key]
		})
		return temp
	},

	/**
	 * 创建查询sql参数
	 * @param query  查询参数map
	 * @param config sort: 排序字段名称， page: 当前页面index，limit：限制当前页显示多少记录，force：是否需要强制等于当前值
	 * @returns {{queryArr: Array, queryStr: string}}
	 */
	createQuery(query, config = { sort : 'id', page : 1, limit : 10, force: false }) {
		let queryStr = ""
		let queryArr = []
		if (!this.isEmptyObj(query)) {

			// 过滤未赋值的参数
			query = this.filterMap(query)

			if (Object.keys(query).length > 0) {
				queryStr += ' where ';
				queryStr += Object.keys(query).map(field => {
					let tempStr = ` ?? ${config.force ? '=' : 'like'} ? `;
					queryArr.push(field, config.force ? `${query[field]}` : `%${query[field]}%`)
					return tempStr
				}).join(' and ');
			}

		}

		// 按照那个字段逆序排序
		if (config.sort) {
			queryStr += ` order by ?? desc`;
			queryArr.push(config.sort)
		}

		// 是否查询记录总数
		if (config.page) {
			queryStr += ` limit ? offset ?`;
			queryArr.push(config.limit, (config.page - 1) * config.limit)
		}

		return {
			queryStr, queryArr
		}
	},
	buildQuery(table, query, config = { sort : 'id', page : 1, limit : 10, force: false }) {
		let sql = `select * from ${table} `
		let queryResult = this.createQuery(query, config)
		return {
			queryStr: sql + queryResult.queryStr,
			queryArr: queryResult.queryArr
		}
	},

	/**
	 *  更新返回sql语句和待查询参数
	 * @param table   更新表名
	 * @param params  设置更新的字段名和值
	 * @param query   查询参数
	 * @returns {{queryArr: Array, queryStr: string}}
	 */
	updateQuery(table, params, query) {
		let sql = `UPDATE ${table}  set `;
		let queryArr = []

		if (!this.isEmptyObj(params)) {
			// 设置更新key值
			sql += Object.keys(params).map(field => {
				queryArr.push(field, params[field])
				return ` ?? = ? `;
			}).join(', ');

			// 设置查询参数
			let queryResult = this.createQuery(query, {page: false, force: true})
			sql += queryResult.queryStr
			queryArr = [...queryArr, ...queryResult.queryArr]
		}

		return {
			queryStr: sql,
			queryArr
		}
	},

	/**
	 *
	 * @param table
	 * @param params
	*/
	insertQuery(table, params) {
		let sql = ` insert into ${table} ( `
		let queryArr = []
		// 插入语句为数组对象，多条数据
		if (this.isArray(params)) {
			return this.multipleInsertQuery(params, sql, queryArr)
		}
		// 插入语句为对象，单条数据
		if (!this.isEmptyObj(params)) {
			return this.singleInsertQuery(params, sql, queryArr)
		}
		return {}
	},

	/**
	 * @description 插入语句为数组对象，多条数据
	*/
	multipleInsertQuery(params, sql, queryArr) {
		sql += Object.keys(params[0]).map(field => {
			queryArr.push(field)
			return ` ?? `
		}).join(', ')
		sql += ') VALUES '
		params.map((item, index) => {
			sql += '('
			sql += Object.keys(item).map(field => {
				queryArr.push(item[field])
				return ` ? `
			}).join(', ')
			sql += ')'
			if ((index + 1) !== params.length) {
				sql += ','
			}
		})
		return {
			queryStr: sql,
			queryArr
		}
	},

	/**
	 * @description 插入语句为对象，单条数据
	*/
	singleInsertQuery(params, sql, queryArr) {
		sql += Object.keys(params).map(field => {
			queryArr.push(field)
			return ` ?? `
		}).join(', ')
		sql += ') VALUES ('
		sql += Object.keys(params).map(field => {
			queryArr.push(params[field])
			return ` ? `
		}).join(', ')
		sql += ')'
		return {
			queryStr: sql,
			queryArr
		}
	},

	deleteQuery(table, query) {
		let sql = `delete from ${table} `;
		let queryResult = this.createQuery(query, {page: false, force: true})
		sql += queryResult.queryStr
		return {
			queryStr: sql,
			queryArr: queryResult.queryArr
		}
	},

	/**
	 * 查询判断是否有该条件下的记录
	 * @param handler  查询句柄
	 * @param table   查询表
	 * @param params    查询参数
	 * @returns {Promise<boolean>}
	 */
	async checkHasRecord(handler, params) {
		let sql = `select * from ${handler.table} `
		let queryResult = this.createQuery(params, { force: true })
		sql += queryResult.queryStr
		let ret = await handler.query(sql, queryResult.queryArr)
		return !!ret[0];
	}


}
