/**************************************
现货长线量化价值投资策略V1.0
1.设定一个币种最小持仓量和最大持仓量
2.当行情处于下降通道，且市场价格低于当前持仓平均价格或上一次买入的价格时，买入设定的操作粒度，直到最大持仓量
3.当行情处于上升通道，且市场价格高于当前持仓平均价格或上一次卖出的价格时，卖出设定的操作粒度，直到最小持仓量，当到达最小持仓量的时候，平均价格清0，使得程序可以重新买入新量。
4.均线周期使用1小时均线，频率为1分钟。
5.最小持仓量的币是用来增值的，最小持仓量到最大持仓量之间的币是用来获利的。可以定期根据盈利情况来调整这两个值，以加大持仓或减少
6.本策略为价值投资策略，目的是可以在市场低迷的时候吃进持仓，市场行情好的时候出货套一定的现。
  不追求短线高频交易，而是在一定时间内的大跌大涨中拥获价值投资的机会使得持仓平均价格不断的降低,并使得最小持仓量的币保持最低的价格，等币价升值。
7.即然是价值投资，选币就很重要的，一定要选有投资价值的币种，不要是那种一跌不起的币
8.本策略在大跌大涨行情中效果最好，涨跌互现或是跌得很深的情况下，只要子弹够多，那么可以拿到很多便宜的货，以前我们人为操作的时候，总是会出现
  以为行情已经到底了，所以大举买入，但是谁知被套在一个相对高位了。此策略以每次操作的粒度进行限制，以使得每次不会全仓进入，这样可以有更多的
  机会可以拿到更便宜的货。
9.程序使用了机器人的本地存储，暂停和重启机器人不会影响保存的数据，但是如果新建机器人需要手动计算当前帐户的持仓均价并填入参数当中。

策略参数如下
参数	描述	类型	默认值
MaxCoinLimit	最大持仓量	数字型(number)	1200
MinCoinLimit	最小持仓量	数字型(number)	600
OperateFineness	买卖操作的粒度	数字型(number)	100
NowCoinPrice	当前持仓平均价格		数字型(number)	0
BuyFee	平台买入手续费		数字型(number)	0.002
SellFee	平台卖出手续费		数字型(number)	0.002
MinStockAmount	限价单最小交易数量		数字型(number)	1
MAType	均线算法	下拉框(selected)	EMA|MA|AMA(自适应均线)
************************************************/

//全局常数定义
//操作类型常量
var OPERATE_STATUS_NONE = -1;
var OPERATE_STATUS_BUY = 0; 
var OPERATE_STATUS_SELL = 1;

//全局变量定义
var PriceDecimalPlace = 2;
var StockDecimalPlace = 2;
var TotalProfit = 0;
var lastOrderId = 0;	//上一手订单编号
var operatingStatus = OPERATE_STATUS_NONE;	//正在操作的状态

//获取当前行情
function GetTicker() {
    return _C(exchange.GetTicker);
}

//获取帐户信息
function GetAccount() {
    return _C(exchange.GetAccount);
}

//根据行性数字序列获取线性趋势，大于1为上升通道，小于1为下降通道
function getLinearTrend(linearray){
    var trend = 1;
    var sub = 0;
    if(linearray && linearray.length>=2){
        for(var i=1;i<=linearray.length-1;i++){
            sub += linearray[i]/linearray[i-1];
        }
        trend = sub/(linearray.length-1);
    }
    return trend;
}

//获得当前10个小时之内的收盘价数字序列
function getQuotation(){
    var recrods = _C(exchange.GetRecords,PERIOD_H1);
    var quotations = null;
    if(recrods && recrods.length>=2){
        quotations = recrods.length<10 ? new Array(recrods.length) : new Array(10);
        var j=0;
        for(var i=recrods.length-quotations.length;i<=recrods.length-1;i++){
            quotations[j] = recrods[i].Close;
            j++;
        }
    }
    return quotations;
}

// 返回上穿的周期数. 正数为上穿周数, 负数表示下穿的周数, 0指当前价格一样
function Cross(a, b) {
    var pfnMA = [TA.EMA, TA.MA, talib.KAMA][MAType];
    var crossNum = 0;
    var arr1 = [];
    var arr2 = [];
    if (Array.isArray(a)) {
        arr1 = a;
        arr2 = b;
    } else {
        var records = null;
        while (true) {
            records = exchange.GetRecords();
            if (records && records.length > a && records.length > b) {
                break;
            }
            Sleep(1000);
        }
        arr1 = pfnMA(records, a);
        arr2 = pfnMA(records, b);
    }
    if (arr1.length !== arr2.length) {
        throw "array length not equal";
    }
    for (var i = arr1.length - 1; i >= 0; i--) {
        if (typeof(arr1[i]) !== 'number' || typeof(arr2[i]) !== 'number') {
            break;
        }
        if (arr1[i] < arr2[i]) {
            if (crossNum > 0) {
                break;
            }
            crossNum--;
        } else if (arr1[i] > arr2[i]) {
            if (crossNum < 0) {
                break;
            }
            crossNum++;
        } else {
            break;
        }
    }
    return crossNum;
}

//获得价格的小数位数
function getPriceDecimalPlace() {
    return GetTicker().Last.toString().split(".")[1].length;
}
//获得交易量的小数位数
function getStockDecimalPlace() {
	return exchange.GetMinStock().toString().split(".")[1].length;
}
//从帐户中获取当前持仓信息
function getAccountStocks(account){
	var stocks = 0;
	//if(account) stocks = account.Stocks+account.FrozenStocks;
	if(account) stocks = account.Stocks;
	return stocks;
}

//处理卖出成功之后数据的调整
function changeDataForSell(order){
	//累加成交量
	var dealAmount = _G("DealAmount");
	dealAmount -= order.DealAmount;
	_G("DealAmount",dealAmount);
	
	//计算持仓总价
	var Total = _G("Total");
	Total -= parseFloat((order.AvgPrice * order.DealAmount).toFixed(PriceDecimalPlace));
	_G("Total",Total);
	
	//记录盈利情况
	//算出扣除平台手续费后实际的数量
	var actualAmount = order.DealAmount*(1 - SellFee);
	var avgPrice = _G("AvgPrice");
	var profit = parseFloat(((order.AvgPrice - avgPrice) * actualAmount).toFixed(PriceDecimalPlace));
	TotalProfit += profit;
	LogProfit(TotalProfit);
	
	if(order.DealAmount === order.Amount ){
		Log("订单",lastOrderId,"交易成功!平均卖出价格：",order.AvgPrice,"，平均持仓价格：",avgPrice,"，卖出数量：",order.DealAmount,"，浮动盈利：",profit,"，累计盈利：",TotalProfit);
	}else{
		Log("订单",lastOrderId,"部分成交!卖出数量：",order.DealAmount,"，剩余数量：",order.Amount - order.DealAmount,"，平均卖出价格：",order.AvgPrice,"，平均持仓价格：",avgPrice,"，浮动盈利：",profit,"，累计盈利：",TotalProfit);
	}
	
	//设置最后一次卖出价格
	if(order.DealAmount>(order.Amount/2)){
		_G("lastSellPrice",order.AvgPrice);
	}
}

//检测卖出订单是否成功
function checkSellFinish(){
    var ret = true;
	var order = exchange.GetOrder(lastOrderId);
	if(order.Status === ORDER_STATE_CLOSED ){
		changeDataForSell(order);
	}else if(order.Status === ORDER_STATE_PENDING ){
		if(order.DealAmount){
			changeDataForSell(order);
		}else{
			Log("订单",lastOrderId,"未有成交!卖出价格：",order.Price,"，当前买一价：",exchange.GetTicker().Buy,"，价格差：",_N(order.Price - exchange.GetTicker().Buy, PriceDecimalPlace));
		}
		//撤消没有完成的订单，如果交叉周期在5以内不急着取消挂单        
		exchange.CancelOrder(lastOrderId);
		Log("取消卖出订单：",lastOrderId);
		Sleep(1300);
	}
    return ret;
}

//处理买入成功之后数据的调整
function changeDataForBuy(order){
	//算出扣除平台手续费后实际的数量
	var actualAmount = order.DealAmount*(1 - BuyFee);
	
	//累加成交量
	var dealAmount = _G("DealAmount");
	dealAmount += actualAmount;
	_G("DealAmount",dealAmount);
	
	//计算持仓总价
	var Total = _G("Total");
	Total += parseFloat((order.AvgPrice * actualAmount).toFixed(PriceDecimalPlace));
	_G("Total",Total);
	
	//计算平均价格
	var avgPrice = parseFloat((Total / dealAmount).toFixed(PriceDecimalPlace));
	_G("AvgPrice",avgPrice);
	
	if(order.DealAmount === order.Amount ){
		Log("买入订单",lastOrderId,"交易成功!成交均价：",order.AvgPrice,"，数量：",order.DealAmount,"，持仓价格调整到：",avgPrice,"，总持仓数量：",dealAmount,"，持币价值：",Total);			
	}else{
		Log("买入订单",lastOrderId,"部分成交!成交均价：",order.AvgPrice,"，数量：",order.DealAmount,"，持仓价格调整到：",avgPrice,"，总持仓数量：",dealAmount,"，持币价值：",Total);			
	}
	
	//设置最后一次买入价格,仅在买入量超过一半的情况下调整最后买入价格，没到一半继续买入
	if(order.DealAmount>(order.Amount/2)){
		_G("lastBuyPrice",order.AvgPrice);
	}
					
	//判断是否更新了历史最低持仓价
	var historyMinPrice = _G("historyMinPrice") ? _G("historyMinPrice") : 0;
	if(avgPrice < historyMinPrice){
		Log("当前持仓均价达到历史最低持仓均价",avgPrice,"，更新最低持仓均价。");
		_G("historyMinPrice",avgPrice);
	}

}

//检测买入订单是否成功
function checkBuyFinish(){
	var order = exchange.GetOrder(lastOrderId);
	if(order.Status === ORDER_STATE_CLOSED ){
		//处理买入成功后的数据调整
		changeDataForBuy(order);
	}else if(order.Status === ORDER_STATE_PENDING ){
		if(order.DealAmount){
			//处理买入成功后的数据调整
			changeDataForBuy(order);
		}else{
			Log("买入订单",lastOrderId,"未有成交!订单买入价格：",order.Price,"，当前卖一价：",exchange.GetTicker().Sell,"，价格差：",_N(order.Price - exchange.GetTicker().Sell, PriceDecimalPlace));
		}
		//撤消没有完成的订单
		exchange.CancelOrder(lastOrderId);
		Log("取消未完成的买入订单：",lastOrderId);
		Sleep(1300);
	}
}

//定时任务，主业务流程 
function onTick() {
	//获取实时信息
	var Account = GetAccount();
    var Ticker = GetTicker();
	Log("账户余额", Account.Balance, "，冻结余额", Account.FrozenBalance, "可用币数", Account.Stocks, "，冻结币数", Account.FrozenStocks, "，当前币价", Ticker.Sell );
	
	//检测上一个订单，成功就改状态，不成功就取消重新发
	if(lastOrderId && operatingStatus != OPERATE_STATUS_NONE){
		if(operatingStatus > OPERATE_STATUS_BUY){
			checkSellFinish();
		}else{
			checkBuyFinish();
		}
		//刚才上一次订单ID清空，不再重复判断
		lastOrderId = 0;
		//重置操作状态
		operatingStatus = OPERATE_STATUS_NONE;
	}

    //测试平均价格的调整
    var lastBuyPrice = _G("lastBuyPrice") ? _G("lastBuyPrice") : 0;
    var lastSellPrice = _G("lastSellPrice") ? _G("lastSellPrice") : 0;
    var avgPrice = _G("AvgPrice") ? _G("AvgPrice") : NowCoinPrice;
	var historyMinPrice = _G("historyMinPrice") ? _G("historyMinPrice") : 0;
    var dealAmount = _G("DealAmount") ? _G("DealAmount") : getAccountStocks(Account); //程序初次在机器人运行时，从帐户中获取当前持仓信息
    var Total = _G("Total") ? _G("Total") : avgPrice*dealAmount;	//程序初次在机器人运行时，从帐户中获取当前持仓信息和平均价格算出来
	var opAmount = 0;
    var orderid = 0;
	var isOperated = false;	
	Log("历史最低均价", historyMinPrice, "，当前持仓均价", avgPrice, "，持仓数量", _N(dealAmount,StockDecimalPlace), "，上一次买入", lastBuyPrice, "，上一次卖出", lastSellPrice, "，总持资金", _N(Total, PriceDecimalPlace), "，累计收益", _N(TotalProfit, PriceDecimalPlace));
	//获取行情数据
    var crossNum = Cross(5, 15);
    if (crossNum > 0) {
        Log("当前交叉数为", crossNum, ",处于上升通道");
    } else {
        Log("当前交叉数为", crossNum, ",处于下降通道");
    }
    var baseBuyPrice = lastBuyPrice ? lastBuyPrice : avgPrice;
    var baseSellPrice = lastSellPrice ? lastSellPrice : avgPrice;
    Log("当前基准买入价格=", baseBuyPrice, "，当前基准卖出价格=", baseSellPrice);
    if (crossNum < 0 && (dealAmount === 0 || baseBuyPrice === 0 || Ticker.Sell < baseBuyPrice * (1 - 0.05 - BuyFee))) {
		if(dealAmount <= MaxCoinLimit){
			//判断当前余额下可买入数量
			var canpay = (MaxCoinLimit - dealAmount) * Ticker.Sell;
			if(Account.Balance < canpay){
				canpay = Account.Balance;
			}
			var canbuy = canpay/Ticker.Sell;
			opAmount = canbuy > OperateFineness? OperateFineness : canbuy;
			opAmount = _N(opAmount, StockDecimalPlace);
			if(opAmount > MinStockAmount){
				if(dealAmount === 0 || baseBuyPrice === 0){
					Log("程序运行之后第一次买入，以现价", Ticker.Sell, "，准备买入",opAmount,"个币。");
				}else{
					Log("当前市价", Ticker.Sell, " < 买入点", parseFloat((baseBuyPrice * (1 - 0.05 - BuyFee)).toFixed(PriceDecimalPlace)), "，准备买入",opAmount,"个币。");
				}
				isOperated = true;
				operatingStatus = OPERATE_STATUS_BUY;
				orderid = exchange.Buy(Ticker.Sell, opAmount);
			}else{
				Log("当前有机会买入，但当前账户余额不足，已经不能再买进了。");
			}
		}else{
			Log("当前持仓数量已经达到最大持仓量", MaxCoinLimit, "，不再买入，看机会卖出。");
			_G("ToTheBiggest", true);
		}
    } else if (crossNum > 0 && Ticker.Buy > baseSellPrice * (1 + 0.05 + SellFee)) {
		opAmount = (dealAmount - MinCoinLimit) > OperateFineness? OperateFineness : _N((dealAmount - MinCoinLimit),StockDecimalPlace);
		if(dealAmount > MinCoinLimit && opAmount > MinStockAmount){
			Log("当前市价", Ticker.Buy, " > 卖出点", parseFloat((baseSellPrice * (1 + 0.05 + SellFee)).toFixed(PriceDecimalPlace)), "，准备卖出",opAmount,"个币");
			isOperated = true;
			operatingStatus = OPERATE_STATUS_SELL;
			orderid = exchange.Sell(Ticker.Buy, opAmount);
		}else{
			Log("当前持仓数量小于最小持仓量", MinCoinLimit, "，不能卖出，看机会再买入。");

			if(_G("ToTheBiggest")){
				Log("当前持仓数量已经达到最大持仓量后再次达到最小持仓量，这种情况下重置平均持仓价格，以使得之后有条件买入。");
				_G("AvgPrice",Ticker.Buy);
				_G("ToTheBiggest",false);
			}
		}
    } else {
		if (crossNum < 0 ){
			Log("价格没有下跌到买入点，继续观察行情...");
		}else{
			Log("价格没有上涨到卖出点，继续观察行情...");
		}
    }
    //判断并输出操作结果
	if(isOperated){
		if (orderid) {
			lastOrderId = orderid;
			Log("订单发送成功，订单编号：",lastOrderId);
		}else{
			operatingStatus = OPERATE_STATUS_NONE;
			Log("订单发送失败，取消正在操作状态");
		}
	}
}

function main() {
    LogReset();
	Log("启动数字货币现货长线量化价值投资策略程序...");  

	//获取价格及交易量的小数位
    PriceDecimalPlace = getPriceDecimalPlace();
    StockDecimalPlace = getStockDecimalPlace();
    //设置小数位，第一个为价格小数位，第二个为数量小数位
    exchange.SetPrecision(PriceDecimalPlace, StockDecimalPlace);
	Log("设置了交易平台价格小数位为",PriceDecimalPlace,"数额小数位为",StockDecimalPlace);  
	
    while (true) {
        onTick();
        Sleep(60 * 1000);
    }
}