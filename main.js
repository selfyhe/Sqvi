/**************************************
现货长线量化价值投资策略V1.1
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
NowCoinPrice	当前持仓平均价格/指导买入价格	数字型(number)	0
BuyFee	平台买入手续费		数字型(number)	0.002
SellFee	平台卖出手续费		数字型(number)	0.002
PriceDecimalPlace	交易对价格小数位		数字型(number)	2 
StockDecimalPlace	交易对数量小数位		数字型(number)	4 
MinStockAmount	限价单最小交易数量		数字型(number)	1
DefaultProfit 指导买入卖出点	是数值不是百分比	数字型(number)	0.05
MAType	均线算法	下拉框(selected)	EMA|MA|AMA(自适应均线)
策略交互如下
NewAvgPrice	更新持仓平均价格	只更新均价不更新上一次买入卖出价，用于手动操作买入之后的均价调整    数字型(number) 0
GuideBuyPrice	更新指导买入价格    只更新上一个买入价，不更新持仓均价，用于想调节买入点	数字型(number) 0
************************************************/

//全局常数定义
//操作类型常量
var OPERATE_STATUS_NONE = -1;
var OPERATE_STATUS_BUY = 0; 
var OPERATE_STATUS_SELL = 1;

//全局变量定义
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

//从帐户中获取当前持仓信息
function getAccountStocks(account){
	var stocks = 0;
	if(account) stocks = account.Stocks;
	return stocks;
}

//处理卖出成功之后数据的调整
function changeDataForSell(account,order){
	//算出扣除平台手续费后实际的数量
	var avgPrice = _G("AvgPrice");
	var TotalProfit = _G("TotalProfit");
	var profit = parseFloat((order.AvgPrice*order.DealAmount*(1-SellFee) - avgPrice*order.DealAmount*(1+BuyFee)).toFixed(PriceDecimalPlace));
	TotalProfit += profit;
	_G("TotalProfit", TotalProfit);
	LogProfit(TotalProfit);
	
	if(order.DealAmount === order.Amount ){
		Log("订单",lastOrderId,"交易成功!平均卖出价格：",order.AvgPrice,"，平均持仓价格：",avgPrice,"，卖出数量：",order.DealAmount,"，毛收盈：",profit,"，累计毛收盈：",TotalProfit);
	}else{
		Log("订单",lastOrderId,"部分成交!卖出数量：",order.DealAmount,"，剩余数量：",order.Amount - order.DealAmount,"，平均卖出价格：",order.AvgPrice,"，平均持仓价格：",avgPrice,"，毛收盈：",profit,"，累计毛收盈：",TotalProfit);
	}
	
	//设置最后一次卖出价格
	if(order.DealAmount>(order.Amount/2)){
		_G("lastSellPrice",order.AvgPrice);
	}
	
	//如果当前持仓数量小于最小交量数量时，价格重置为0，方便短线操作
	var coinAmount = getAccountStocks(account); //从帐户中获取当前持仓信息
	if(coinAmount <= MinStockAmount){
		var newAvgPrive = parseFloat(((order.AvgPrice+avgPrice)/2).toFixed(PriceDecimalPlace));
		Log("成功空仓持币，将指导买入价从原持仓均价",avgPrice,"调整为",newAvgPrive);
		_G("AvgPrice",newAvgPrive);
		_G("lastBuyPrice",0);
		_G("lastSellPrice",0);
	}
}

//检测卖出订单是否成功
function checkSellFinish(account){
    var ret = true;
	var order = exchange.GetOrder(lastOrderId);
	if(order.Status === ORDER_STATE_CLOSED ){
		changeDataForSell(account,order);
	}else if(order.Status === ORDER_STATE_PENDING ){
		if(order.DealAmount){
			changeDataForSell(account,order);
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
function changeDataForBuy(account,order){
	//读取原来的持仓均价和持币总量
	var avgPrice = _G("AvgPrice");
	var coinAmount = getAccountStocks(account);
	
	//计算持仓总价
	var Total = parseFloat((avgPrice*(coinAmount-order.DealAmount*(1-BuyFee))+order.AvgPrice * order.DealAmount).toFixed(PriceDecimalPlace));
	
	//计算并调整平均价格
	avgPrice = parseFloat((Total / coinAmount).toFixed(PriceDecimalPlace));
	_G("AvgPrice",avgPrice);
	
	if(order.DealAmount === order.Amount ){
		Log("买入订单",lastOrderId,"交易成功!成交均价：",order.AvgPrice,"，数量：",order.DealAmount,"，持仓价格调整到：",avgPrice,"，总持仓数量：",coinAmount,"，总持币成本：",Total);			
	}else{
		Log("买入订单",lastOrderId,"部分成交!成交均价：",order.AvgPrice,"，数量：",order.DealAmount,"，持仓价格调整到：",avgPrice,"，总持仓数量：",coinAmount,"，总持币成本：",Total);			
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
function checkBuyFinish(account){
	var order = exchange.GetOrder(lastOrderId);
	if(order.Status === ORDER_STATE_CLOSED ){
		//处理买入成功后的数据调整
		changeDataForBuy(account,order);
	}else if(order.Status === ORDER_STATE_PENDING ){
		if(order.DealAmount){
			//处理买入成功后的数据调整
			changeDataForBuy(account,order);
		}else{
			Log("买入订单",lastOrderId,"未有成交!订单买入价格：",order.Price,"，当前卖一价：",exchange.GetTicker().Sell,"，价格差：",_N(order.Price - exchange.GetTicker().Sell, PriceDecimalPlace));
		}
		//撤消没有完成的订单
		exchange.CancelOrder(lastOrderId);
		Log("取消未完成的买入订单：",lastOrderId);
		Sleep(1300);
	}
}

//通过交互按钮更新持仓价格
function updatePrice(coinAmount){
	var avgPrice = _G("AvgPrice");
	if(!avgPrice){
		//平均价格为空或0，说明新启动，尝试从参数读入并写入存储
		avgPrice = NowCoinPrice;
		_G("AvgPrice",avgPrice);
	}
    var cmd=GetCommand();
	if(cmd){
		var cmds=cmd.split(":");
		if(cmds[0] == "NewAvgPrice"){
			if(coinAmount > MinStockAmount && cmds[1] == 0){
				Log("当前有持仓币数，但没有尝试更新持仓价格为0，拒绝操作！！！");
			}else{
				Log("更新持仓价格为",cmds[1]);
				_G("AvgPrice",cmds[1]);
				avgPrice = cmds[1];
			}
		}else if(cmds[0] == "GuideBuyPrice"){
			if(coinAmount > MinStockAmount && cmds[1] == 0){
				Log("当前有持仓币数，但不能设置价格为0的指导价格！！！");
			}else{
				Log("更新指导买入价格为",cmds[1]);
                _G("lastBuyPrice",cmds[1]);
			}
		}
	}
	return avgPrice;
}

//初始运行检测
function checkArgs(){
	var ret = true;
	//检测参数的填写
	if(MaxCoinLimit === 0){
		Log("最大持仓量为0，必须填写此字段。");
		ret = false;
	}
	if(OperateFineness === 0){
		Log("买卖操作的粒度为0，必须填写此字段。");
		ret = false;
	}
	if(NowCoinPrice === 0){
		Log("当前持仓平均价格/指导买入价格为0，必须填写此字段。");
		ret = false;
	}
	if(BuyFee === 0 || SellFee === 0){
		Log("平台买卖手续费为0，必须填写此字段。");
		ret = false;
	}
	if(PriceDecimalPlace === 0 || StockDecimalPlace === 0){
		Log("交易对价格/数量小数位为0，必须填写此字段。");
		ret = false;
	}
	if(MinStockAmount === 0){
		Log("限价单最小交易数量为0，必须填写此字段。");
		ret = false;
	}
	if(DefaultProfit === 0){
		Log("指导买入卖出点为0，必须填写此字段。");
		ret = false;
	}
	Log("接收参数如下：最大持仓量", MaxCoinLimit, "，买卖操作的粒度", OperateFineness, "，当前持仓平均价格/指导买入价格", NowCoinPrice, "，平台买卖手续费（", BuyFee, SellFee,"），交易对价格/数量小数位（", PriceDecimalPlace, StockDecimalPlace,"），限价单最小交易数量", MinStockAmount,"，指导买入卖出点", DefaultProfit);
	return ret;
}

//定时任务，主业务流程 
function onTick() {
	//获取实时信息
	var Account = GetAccount();
    var Ticker = GetTicker();
	Log("账户余额", Account.Balance, "，冻结余额", Account.FrozenBalance, "可用币数", Account.Stocks, "，冻结币数", Account.FrozenStocks, "，当前币价", Ticker.Sell );

	//处理持仓价格变量
    var coinAmount = getAccountStocks(Account); //从帐户中获取当前持仓信息
    var avgPrice = updatePrice(coinAmount);
	if(coinAmount > MinStockAmount && avgPrice === 0){
		Log("当前有持仓币数，但没有填入持仓价值！！！");
		return;
	}
	
	//检测上一个订单，成功就改状态，不成功就取消重新发
	if(lastOrderId && operatingStatus != OPERATE_STATUS_NONE){
		if(operatingStatus > OPERATE_STATUS_BUY){
			checkSellFinish(Account);
		}else{
			checkBuyFinish(Account);
		}
		//刚才上一次订单ID清空，不再重复判断
		lastOrderId = 0;
		//重置操作状态
		operatingStatus = OPERATE_STATUS_NONE;
	}

    //定义并初始化其他变量
    var lastBuyPrice = _G("lastBuyPrice") ? _G("lastBuyPrice") : 0;
    var lastSellPrice = _G("lastSellPrice") ? _G("lastSellPrice") : 0;
	var historyMinPrice = _G("historyMinPrice") ? _G("historyMinPrice") : 0;
    var Total = avgPrice*coinAmount;	//从帐户中获取当前持仓信息和平均价格算出来
	var opAmount = 0;
    var orderid = 0;
	var isOperated = false;	
	Log("历史最低均价", historyMinPrice, "，当前持仓均价", avgPrice, "，持币数量", _N(coinAmount,StockDecimalPlace), "，上一次买入", lastBuyPrice, "，上一次卖出", lastSellPrice, "，总持币成本", _N(Total, PriceDecimalPlace));

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
    if (crossNum < 0 && (Ticker.Sell < baseBuyPrice * (1 - DefaultProfit - BuyFee))) {
		if(coinAmount <= MaxCoinLimit){
			//判断当前余额下可买入数量
			var canpay = (MaxCoinLimit - coinAmount) * Ticker.Sell;
			if(Account.Balance < canpay){
				canpay = Account.Balance;
			}
			var canbuy = canpay/Ticker.Sell;
			opAmount = canbuy > OperateFineness? OperateFineness : canbuy;
			opAmount = _N(opAmount, StockDecimalPlace);
			if(opAmount > MinStockAmount){
				if(coinAmount <= MinStockAmount || baseBuyPrice === 0){
					Log("程序运行之后或卖空之后第一次买入，以现价", Ticker.Sell, "，准备买入",opAmount,"个币。");
				}else{
					Log("当前市价", Ticker.Sell, " < 买入点", parseFloat((baseBuyPrice * (1 - DefaultProfit - BuyFee)).toFixed(PriceDecimalPlace)), "，准备买入",opAmount,"个币。");
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
    } else if (crossNum > 0 && Ticker.Buy > baseSellPrice * (1 + DefaultProfit + SellFee)) {
		opAmount = (coinAmount - MinCoinLimit) > OperateFineness? OperateFineness : _N((coinAmount - MinCoinLimit),StockDecimalPlace);
		if(coinAmount > MinCoinLimit && opAmount > MinStockAmount){
			Log("当前市价", Ticker.Buy, " > 卖出点", parseFloat((baseSellPrice * (1 + DefaultProfit + SellFee)).toFixed(PriceDecimalPlace)), "，准备卖出",opAmount,"个币");
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
	
	//检测参数的填写
	if(!checkArgs()) return;

    //设置小数位，第一个为价格小数位，第二个为数量小数位
    exchange.SetPrecision(PriceDecimalPlace, StockDecimalPlace);
	Log("设置了交易平台价格小数位为",PriceDecimalPlace,"数额小数位为",StockDecimalPlace);  
	
    while (true) {
        onTick();
        Sleep(60 * 1000);
    }
}