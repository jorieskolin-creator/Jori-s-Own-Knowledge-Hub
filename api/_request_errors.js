'use strict';

// Messages for input errors describe fixed rules and never include input values.
class RequestInputError extends RangeError {
 constructor(reason,message){
  super(message);
  this.reason=reason;
 }
}

class SourceAccessError extends Error {}

module.exports={RequestInputError,SourceAccessError};
