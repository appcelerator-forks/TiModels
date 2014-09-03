/*
 * tiModel.js
 * Defines extra functions for models and collections, such as nested models, automatic data type translation
 * and extra SQL functions
 */

var NO_QUERY_ERROR = "No query info for the model. You should call query() before starting query statements";
var tiModel = {
	modelBase : {
		/**
		 * Sets the data based on the model's config.columns info.
		 * current data types supported:
		 * TYPE 									- JS data type 			- SQL data type
		 * =========================================================================================
		 * TEXT/VARCHAR/CHAR						- string				- TEXT
		 * INTEGER/INT/TINYINT/SMALLINT/BIGINT 		- number 				- INTEGER
		 * REAL/FLOAT/DECIMAL/NUMBER				- number 				- REAL
		 * BOOL/BOOLEAN 							- boolean 				- INTEGER
		 * DATE/DATETIME 							- moment.js 			- INTEGER (unix time)
		 * BLOB 									- Ti.Blob 				- BLOB
		 *
		 * Other type not named here 				- unchanged				- TEXT (JSON.stringify)
		 */
		set : function(values, opts){
			console.log("[modelBase] - model.set - values: " + JSON.stringify(values) + ' - opts: ' + JSON.stringify(opts));
			for(var fieldName in values){
				var type = this.config.columns[fieldName] ? this.config.columns[fieldName] : '';
				type = type.split(/\s+/)[0];
				var newValue = values[fieldName];
				switch(type.toLowerCase()){
					case 'text':
					case 'varchar':
					case 'char':
						values[fieldName] = '' + (newValue || '');
						break;
					case 'integer':
					case 'int':
					case 'tinyint':
					case 'smallint':
					case 'bigint':
						values[fieldName] = parseInt(newValue) || 0;
						break;
					case 'real':
					case 'float':
					case 'decimal':
					case 'number':
						values[fieldName] = parseFloat(newValue) || 0;
						break;
					case 'bool':
					case 'boolean':
						values[fieldName] = Boolean(newValue);
						break;
					case 'date':
					case 'datetime':
						if(!moment.isMoment(newValue)){
							values[fieldName] = new moment(newValue || undefined);
						}
						break;
				}

				if(this.get(fieldName) !== newValue && fieldName !== '_updated'){
					values._updated = 1;
				}
			}
			return Backbone.Model.prototype.set.call(this, values, opts);
		},
		/**
		 * Sets default vaules based on the model's config.relations info
		 * Current relation types supported:
		 * 1:1 - defines a new Alloy Model inside this one
		 * 1:n - defines a new Alloy Collection inside this one
		 */
		defaults : function(){
			var defaultValues = {
				'_updated' : 0
			};
			var values = this.config.defaults || {};
			for(var name in values){
				defaultValues[name] = values[name];
			}

			var defaultRelations = {};
			var relations = this.config.relations || {};
			for(var name in relations){
				var relation = relations[name];
				var modelName = relation.model;
				var create;
				switch(relation.type){
					case '1:1':
						create = Alloy.createModel;
						break;
					case '1:n':
						create = Alloy.createCollection;
						break;
				}
				defaultRelations[name] = create(modelName);
			}

			_.extend(defaultValues, defaultRelations);

			return defaultValues;
		},
		/**
		 * Retrieves the model from SQLite database.
		 * if the idAttribute was previously setted, the query will be automatically generated
		 * if the query() function was previously called, it will automatically generate the query
		 * based on the given statements.
		 * if the model has relations declared, all the models & collections will be also fetched from
		 * the database
		 */
		fetch : function(opts){
			opts = opts || {};
			
			if(this._buildingQuery){
				opts.query = buildQuery();
				this._buildingQuery = false;
				this._queryInfo = {};
			} else if(opts.select || opts.join || opts.from || opts.where || opts.groupBy || opts.orderBy || opts.limit){
				//TODO lol
			}

			var fetchBackbone = Backbone.Model.prototype.fetch.call(this, opts);
			fetchRelations();

			return fetchBackbone;
		},
		save : function(attrs, opts){
			attrs = attrs || {};
			opts = opts || {};

			var saveBackbone = Backbone.Model.prototype.save.call(this, attrs, opts);

			var relations = this.config.relations || {};
			for(var name in relations){
				var relation = relations[name];
				var foreignKey = relation.foreignKey;
				
				switch(relation.type){
					case '1:1':
						opts.saveChildren && this.get(name).save();
						this.set(foreignKey, model.id);
						break;
					case '1:n':
						var collection = this.get(name);
						collection.each(function(model){
							model.set(foreignKey, this.id);
						});
						break;
				}

				opts.saveChildren && this.get(name).save();
				
			}

			return saveBackbone;
		},
		/**
		 * Initializes the query to be built upon the fetch() function
		 */
		query : function(){
			this._buildingQuery = true;
			this._queryInfo = { limit : [1] };
			return this;
		},
		/**
		 * Declares the SELECT statement for the query.
		 * If select() is being called multiple times, multiple SELECT statements will be added
		 * @param statement {String} Select statement
		 * @param params {String/Array} values to replace inside the statement
		 */
		select : function(statement, params){
			addQueryStatement(statement, params, 'select');
			return this;
		},
		/**
		 * Declares the FROM statement for the query.
		 * If from() is being called multiple times, multiple FROM statements will be added
		 * @param statement {String} Select statement
		 * @param params {String/Array} values to replace inside the statement
		 */
		from : function(statement, params){
			addQueryStatement(statement, params, 'from');
			return this;
		},
		/**
		 * Declares the JOIN statement for the query.
		 * If join() is being called multiple times, multiple JOIN statements will be added
		 * @param statement {String} Select statement
		 * @param params {String/Array} values to replace inside the statement
		 */
		join : function(statement, params){
			addQueryStatement(statement, params, 'join');
			return this;
		},
		/**
		 * Declares the WHERE statement for the query.
		 * If where() is being called multiple times, multiple WHERE statements will be added
		 * @param statement {String} Select statement
		 * @param params {String/Array} values to replace inside the statement
		 */
		where : function(statement, params){
			addQueryStatement(statement, params, 'where');
			return this;
		},
		/**
		 * Declares the GROUP BY statement for the query.
		 * If groupBy() is being called multiple times, multiple GROUP BY statements will be added
		 * @param statement {String} Select statement
		 * @param params {String/Array} values to replace inside the statement
		 */
		groupBy : function(statement, params){
			addQueryStatement(statement, params, 'groupBy');
			return this;
		},
		/**
		 * Declares the ORDER BY statement for the query.
		 * If orderBy() is being called multiple times, multiple ORDER BY statements will be added
		 * @param statement {String} Select statement
		 * @param params {String/Array} values to replace inside the statement
		 */
		orderBy : function(statement, params){
			addQueryStatement(statement, params, 'orderBy');
			return this;
		},
		/**
		 * Declared the limit value to use in the LIMIT sql statement.
		 * @param from {Number} starting limit
		 * @param length {Number} records to retrieve
		 */
		limit : function(from, length){
			if(!this._queryInfo){
				console.error(NO_QUERY_ERROR);
				return false;
			}
			this._queryInfo.limit = [from];
			length && this._queryInfo.limit.push(length);
			return this;
		}
	},
	collectionBase : {
		/**
		 * Retrieves the collection from SQLite database.
		 * if the query() function was previously called, it will automatically generate the query
		 * based on the given statements.
		 */
		fetch : function(opts){
			opts = opts || {};
			
			if(this._buildingQuery){
				opts.query = buildQuery();
				this._buildingQuery = false;
				this._queryInfo = {};
			}

			return Backbone.Collection.prototype.fetch.call(this, opts);
		},
		/**
		 * Initializes the query to be built upon the fetch() function
		 */
		query : function(){
			this._buildingQuery = true;
			this._queryInfo = {};
			return this;
		},
		/**
		 * Declares the SELECT statement for the query.
		 * If select() is being called multiple times, multiple SELECT statements will be added
		 * @param statement {String} Select statement
		 * @param params {String/Array} values to replace inside the statement
		 */
		select : function(statement, params){
			addQueryStatement(statement, params, 'select');
			return this;
		},
		/**
		 * Declares the FROM statement for the query.
		 * If from() is being called multiple times, multiple FROM statements will be added
		 * @param statement {String} Select statement
		 * @param params {String/Array} values to replace inside the statement
		 */
		from : function(statement, params){
			addQueryStatement(statement, params, 'from');
			return this;
		},
		/**
		 * Declares the JOIN statement for the query.
		 * If join() is being called multiple times, multiple JOIN statements will be added
		 * @param statement {String} Select statement
		 * @param params {String/Array} values to replace inside the statement
		 */
		join : function(statement, params){
			addQueryStatement(statement, params, 'join');
			return this;
		},
		/**
		 * Declares the WHERE statement for the query.
		 * If where() is being called multiple times, multiple WHERE statements will be added
		 * @param statement {String} Select statement
		 * @param params {String/Array} values to replace inside the statement
		 */
		where : function(statement, params){
			addQueryStatement(statement, params, 'where');
			return this;
		},
		/**
		 * Declares the GROUP BY statement for the query.
		 * If groupBy() is being called multiple times, multiple GROUP BY statements will be added
		 * @param statement {String} Select statement
		 * @param params {String/Array} values to replace inside the statement
		 */
		groupBy : function(statement, params){
			addQueryStatement(statement, params, 'groupBy');
			return this;
		},
		/**
		 * Declares the ORDER BY statement for the query.
		 * If orderBy() is being called multiple times, multiple ORDER BY statements will be added
		 * @param statement {String} Select statement
		 * @param params {String/Array} values to replace inside the statement
		 */
		orderBy : function(statement, params){
			addQueryStatement(statement, params, 'orderBy');
			return this;
		},
		/**
		 * Declared the limit value to use in the LIMIT sql statement.
		 * @param from {Number} starting limit
		 * @param length {Number} records to retrieve
		 */
		limit : function(from, length){
			if(!this._queryInfo){
				console.error(NO_QUERY_ERROR);
				return false;
			}
			this._queryInfo.limit = [from];
			length && this._queryInfo.limit.push(length);
			return this;
		}
	}
};


//Common private functions
function fetchRelations(){
	var relations = this.config.relations || {};
	for(var name in relations){
		var relation = relations[name];
		var foreignKey = relation.foreignKey;
		
		switch(relation.type){
			case '1:1':
				var idAttribute = model.idAttribute || 'alloy_id';
				var model = this.get(name);
				
				model
					.query()
					.where(idAttribute + ' = ?', this.get(foreignKey))
					.fetch();
				break;
			case '1:n':
				var collection = this.get(name);
				
				collection
					.query()
					.where(foreignKey + ' = ?', this.id)
					.fetch();
				break;
		}
		
	}
};
function addQueryStatement(queryPartName, statement, params){
	var counter = -1;
	params = [].concat(params); //Make sure params is ALWAYS an Array

	if(!this._queryInfo){
		console.error(NO_QUERY_ERROR);
		return false;
	}
	!this._queryInfo[queryPartName] && (this._queryInfo[queryPartName] = []);
	
	statement = statement.replace(/\?/g, function(){
		counter++;
		return "'" + params[counter] + "'";
	});
	
	this._queryInfo[queryPartName].push(statement);
};
function buildQuery(){
	var queryInfo = this._queryInfo;
	if(!queryInfo){
		console.error(NO_QUERY_ERROR);
		return false;
	}
	var query = "";
	var table = this.config.adapter.collection_name;

	query += "SELECT " + queryInfo.select ? queryInfo.select.join(', ') : "*";
	query += " FROM " + queryInfo.from ? queryInfo.from.join(', ') : table;
	if(queryInfo.join){
		query += " JOIN " + queryInfo.join.join(' ');
	}
	if(queryInfo.where){
		query += " WHERE " + queryInfo.where.join(' AND ');
	}
	if(queryInfo.orderBy){
		query += " ORDER BY " + queryInfo.orderBy.join(', ');
	}
	if(queryInfo.groupBy){
		query += " GROUP BY " + queryInfo.groupBy.join(', ');
	}
	if(queryInfo.limit != null){
		query += " LIMIT " + queryInfo.limit;
	}

	query += ";";

	console.log('[tiModel] - buildQuery() - query: ' + query);

	return query;
};

module.exports = tiModel;