function bubbleNotify(notification){
  bna = $('.bubbleNotifications').show();
  bnb = bna.clone(true);
  bna.before(bnb);
  bnb.append('<div>'+ notification +'</div>');
  bna.remove();
  bnb.addClass('showBubble').on('animationend', function(){ $(this).empty().removeClass('showBubble').hide(); });
}

function showModal(title, content, isDialog=false){
  if(isDialog){
    $('.dialog').addClass('mini')
  }
  $('.dialog-title').text(title);
  $('.dialog-content').html(content);
  $('.dialog-container').show();
  $('.dialog').css('display','grid');
  $('html').addClass('noScroll');
}

$(function(){
  $(document).on('click','.dialog-container * .dialog-close input, input.dialogCancel',function(){
    $('.dialog-container').hide('clip', function(){ $('.dialog').hide(); });
    $('.dialog-content').empty();
    $('html').removeClass('noScroll');
    $('.dialog').removeClass('mini');
  });

  $(document).on('click','input[type=button].sendAction', function(){
    theButton = $(this);
    showModal('Confirm Action',`<p>${theButton.data('confirmation')}</p><div class="dialogButtons"><input type="button" value="Yes" class="dialogConfirm" data-action="${theButton.data('action')}" data-host-id="${theButton.data('host')}" /> <input type="button" value="Cancel" class="dialogCancel" /></div>`, true);
  });

  $(document).on('click','input.dialogConfirm', function(){
    theForm = $(this);
    formData = theForm.data();
    $.ajax({
      url: `/actions.html?action=${formData.action}`,
      type: 'POST',
      data: formData,
      success: function(theReturn){
        if(theReturn.message !== undefined){
          bubbleNotify(theReturn.message);
        }
        if(theReturn.closeDialog !== undefined){
          window.parent.$('.dialog-close input[type=button]').trigger('click');
        }
        if(theReturn.redirectPage !== undefined){
          setTimeout(() => { window.location = theReturn.redirectPage; }, 3000);
        }
      }
    });
  });

  $(document).on('submit','form',function(){ 
    theForm = $(this);
    formData = theForm.serialize();
    $.ajax({
      url: theForm.attr('action'),
      type: theForm.attr('method'),
      data: formData,
      success: function(theReturn){
        bubbleNotify(theReturn.message);
        if(theReturn.redirectPage !== undefined){
          setTimeout(() => { window.location = theReturn.redirectPage; }, 3000);
        }
      }
    });
    return false;
  });

  $(document).on('click','.tab a', function(){
    $('.tab').removeClass('active');
    $(this).parent('li').addClass('active');
  });
});